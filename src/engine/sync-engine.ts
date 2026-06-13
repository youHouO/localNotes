/**
 * 同步引擎 - WebDAV 增量同步
 *
 * 核心原则：
 * 1. 本地永远是唯一真相源，云端仅作镜像备份
 * 2. 永远基于明文 SHA-256 哈希增量同步（不基于密文哈希）
 * 3. 文字同步优先级永远高于图片
 * 4. 原子同步：单个文件要么成功要么失败
 * 5. 幂等性：重复执行同步不会导致数据错误
 * 6. 冲突处理：最后写入胜出（本地覆盖云端）
 * 7. 同步失败绝不修改或删除本地数据
 *
 * 同步流程：
 * 1. 连接云盘 → 拉取云端 manifest.json
 * 2. 生成本地 manifest（扫描本地 .note 和图片文件）
 * 3. 对比 manifest → 找出需要上传/下载的文件
 * 4. 按优先级执行同步（文字 → 图片）
 * 5. 更新云端 manifest.json
 */

import { createClient, type WebDAVClient } from 'webdav'
import { readFile, writeFile, fileExists } from './storage'
import { getDB } from './database'
import { MANIFEST_FILE_NAME } from '@/config'
import type { CloudDriveConfig, SyncLogEntry, SyncStatus } from '@/types'

// ==================== 类型定义 ====================

/** Manifest 中单个文件的记录 */
interface ManifestEntry {
  path: string        // 相对于云盘根目录的文件路径
  hash: string        // 明文 SHA-256 哈希
  modifiedAt: number  // 最后修改时间戳
  size: number        // 文件大小（字节）
}

/** 完整的 Manifest 结构 */
interface Manifest {
  version: 1
  updatedAt: number
  files: ManifestEntry[]
}

/** 同步差异 */
interface SyncDiff {
  toUpload: ManifestEntry[]    // 本地有但云端没有/已变更的文件
  toDownload: ManifestEntry[]  // 云端有但本地没有的文件（用于恢复）
  unchanged: number            // 未变更文件数
}

/** 同步进度回调 */
type SyncProgressCallback = (current: number, total: number, fileName: string) => void

/** 同步日志回调 */
type SyncLogCallback = (entry: SyncLogEntry) => void

// ==================== WebDAV 客户端管理 ====================

/** 已连接的 WebDAV 客户端缓存 */
const clientCache = new Map<string, WebDAVClient>()

/**
 * 创建 WebDAV 客户端
 * @param config - 云盘配置
 * @returns WebDAV 客户端实例
 */
export function createWebDAVClient(config: CloudDriveConfig): WebDAVClient {
  const cacheKey = `${config.url}:${config.username}`
  if (clientCache.has(cacheKey)) {
    return clientCache.get(cacheKey)!
  }

  const client = createClient(config.url, {
    username: config.username,
    password: config.password,
  })

  clientCache.set(cacheKey, client)
  return client
}

/**
 * 测试 WebDAV 连接
 * @returns 成功返回 true，失败返回错误信息
 */
export async function testConnection(config: CloudDriveConfig): Promise<{ success: boolean; error?: string }> {
  try {
    const client = createWebDAVClient(config)
    // 尝试列出根目录内容来验证连接
    await client.getDirectoryContents('/')
    return { success: true }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

/**
 * 清理客户端缓存（切换账号或删除云盘时）
 */
export function clearClientCache(): void {
  clientCache.clear()
}

// ==================== Manifest 管理 ====================

/**
 * 从云端拉取 manifest.json
 * @returns Manifest 对象，或 null（文件不存在）
 */
async function fetchRemoteManifest(client: WebDAVClient): Promise<Manifest | null> {
  try {
    const exists = await client.exists(`/${MANIFEST_FILE_NAME}`)
    if (!exists) return null

    const content = await client.getFileContents(`/${MANIFEST_FILE_NAME}`, { format: 'text' })
    if (typeof content !== 'string') return null

    return JSON.parse(content) as Manifest
  } catch {
    return null // 云端没有 manifest 或读取失败
  }
}

/**
 * 扫描本地文件系统，生成本地 Manifest
 * 扫描范围：
 * - Books/ 下所有 .note 文件
 * - Books/ 下所有图片文件（Images/ 目录中）
 *
 * 【性能注意】扫描时只计算明文哈希，不解密整个文件
 * 对于已缓存了哈希的文件（来自 SQLite），直接使用缓存值
 */
async function generateLocalManifest(): Promise<Manifest> {
  const entries: ManifestEntry[] = []
  const db = getDB()

  // 方案：从 SQLite 数据库中获取所有笔记的哈希值（已在保存时计算）
  // 这样避免了扫描所有文件时重复计算哈希
  const noteResults = db.exec(`
    SELECT n.id, n.content_hash, n.updated_at, n.book_id
    FROM notes n
    WHERE n.updated_at > 0
  `)

  if (noteResults.length) {
    const cols = noteResults[0].columns
    for (const row of noteResults[0].values) {
      const r: Record<string, unknown> = {}
      cols.forEach((c, i) => { r[c] = row[i] })
      const noteId = r.id as string
      const bookId = r.book_id as string
      const hash = r.content_hash as string
      const updatedAt = r.updated_at as number

      if (hash) {
        entries.push({
          path: `Books/${bookId}/Notes/${noteId}.note`,
          hash,
          modifiedAt: Math.abs(updatedAt),
          size: 0, // 大小在同步时从文件获取
        })
      }
    }
  }

  // 图片文件扫描
  const imageResults = db.exec(`
    SELECT id, book_id, local_path, size, created_at
    FROM images
    WHERE synced = 0 OR 1=1
  `)

  if (imageResults.length) {
    const cols = imageResults[0].columns
    for (const row of imageResults[0].values) {
      const r: Record<string, unknown> = {}
      cols.forEach((c, i) => { r[c] = row[i] })
      entries.push({
        path: r.local_path as string,
        hash: '', // 图片哈希需按需计算
        modifiedAt: r.created_at as number,
        size: r.size as number,
      })
    }
  }

  return {
    version: 1,
    updatedAt: Date.now(),
    files: entries,
  }
}

/**
 * 对比本地和云端 Manifest，生成差异报告
 * - toUpload: 本地有且哈希不同的文件（包括云端没有的新文件）
 * - toDownload: 云端有但本地没有的文件（用于恢复场景）
 */
function diffManifests(local: Manifest, remote: Manifest | null): SyncDiff {
  if (!remote) {
    // 云端没有 manifest，全部上传
    return {
      toUpload: local.files,
      toDownload: [],
      unchanged: 0,
    }
  }

  // 构建远程文件哈希索引
  const remoteMap = new Map<string, ManifestEntry>()
  for (const entry of remote.files) {
    remoteMap.set(entry.path, entry)
  }

  const toUpload: ManifestEntry[] = []
  let unchanged = 0

  for (const localEntry of local.files) {
    const remoteEntry = remoteMap.get(localEntry.path)
    if (!remoteEntry) {
      // 本地新文件，需要上传
      toUpload.push(localEntry)
    } else if (remoteEntry.hash !== localEntry.hash) {
      // 哈希不同，内容已变更，需要上传
      toUpload.push(localEntry)
    } else {
      unchanged++
    }
  }

  // 找出云端有但本地没有的文件（恢复场景）
  const localPaths = new Set(local.files.map((e) => e.path))
  const toDownload = remote.files.filter((e) => !localPaths.has(e.path))

  return { toUpload, toDownload, unchanged }
}

// ==================== 同步执行 ====================

/**
 * 同步状态跟踪
 */
interface SyncState {
  driveId: string
  driveName: string
  status: SyncStatus
  progress: { current: number; total: number }
  errors: string[]
  startedAt: number
}

/** 当前运行的同步任务 */
const activeSyncs = new Map<string, SyncState>()

/**
 * 获取当前同步状态
 */
export function getSyncState(driveId: string): SyncState | undefined {
  return activeSyncs.get(driveId)
}

/**
 * 执行单个云盘的增量同步
 *
 * @param config - 云盘配置
 * @param onProgress - 进度回调
 * @param onLog - 日志回调
 */
export async function syncDrive(
  config: CloudDriveConfig,
  onProgress?: SyncProgressCallback,
  onLog?: SyncLogCallback
): Promise<void> {
  const state: SyncState = {
    driveId: config.id,
    driveName: config.name,
    status: 'syncing',
    progress: { current: 0, total: 0 },
    errors: [],
    startedAt: Date.now(),
  }
  activeSyncs.set(config.id, state)

  const log = (entry: Partial<SyncLogEntry>) => {
    let logId: string
    try {
      logId = crypto.randomUUID()
    } catch {
      logId = `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
    }
    const full: SyncLogEntry = {
      id: logId,
      timestamp: Date.now(),
      driveName: config.name,
      operation: entry.operation || 'upload',
      fileName: entry.fileName || '',
      success: entry.success ?? true,
      errorMessage: entry.errorMessage,
      isConflict: entry.isConflict ?? false,
    }
    onLog?.(full)
  }

  try {
    const client = createWebDAVClient(config)

    // 步骤1：拉取云端 manifest
    const remoteManifest = await fetchRemoteManifest(client)

    // 步骤2：生成本地 manifest
    const localManifest = await generateLocalManifest()

    // 步骤3：对比差异
    const diff = diffManifests(localManifest, remoteManifest)

    // 步骤4：按优先级排序上传队列
    // 文字（.note 文件）优先级高于图片
    const textFiles = diff.toUpload.filter((e) => e.path.endsWith('.note'))
    const imageFiles = diff.toUpload.filter((e) => !e.path.endsWith('.note'))
    const uploadQueue = [...textFiles, ...imageFiles]

    state.progress = { current: 0, total: uploadQueue.length }

    if (uploadQueue.length === 0 && diff.toDownload.length === 0) {
      state.status = 'success'
      log({ operation: 'upload', fileName: '(无变更)', success: true })
      return
    }

    // 步骤5：逐个上传文件
    for (let i = 0; i < uploadQueue.length; i++) {
      const entry = uploadQueue[i]
      state.progress.current = i + 1
      onProgress?.(i + 1, uploadQueue.length, entry.path)

      try {
        await uploadFile(client, entry.path)
        log({ operation: 'upload', fileName: entry.path, success: true })
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err)
        state.errors.push(`${entry.path}: ${errMsg}`)
        log({
          operation: 'upload',
          fileName: entry.path,
          success: false,
          errorMessage: errMsg,
        })
        // 单文件失败不中断整个同步，继续下一个
      }
    }

    // 步骤6：更新云端 manifest
    // 重要：只上传成功同步的文件条目
    if (state.errors.length === 0) {
      try {
        const updatedManifest = await generateLocalManifest()
        await client.putFileContents(
          `/${MANIFEST_FILE_NAME}`,
          JSON.stringify(updatedManifest, null, 2),
          { overwrite: true }
        )
        log({ operation: 'upload', fileName: MANIFEST_FILE_NAME, success: true })
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err)
        log({
          operation: 'upload',
          fileName: MANIFEST_FILE_NAME,
          success: false,
          errorMessage: errMsg,
        })
      }
    }

    // 最终状态
    state.status = state.errors.length > 0 ? 'error' : 'success'
  } catch (err) {
    state.status = 'error'
    const errMsg = err instanceof Error ? err.message : String(err)
    state.errors.push(errMsg)
    log({ operation: 'upload', fileName: '(同步失败)', success: false, errorMessage: errMsg })
  }
}

/**
 * 上传单个文件到 WebDAV
 * 读取本地文件 → 上传到云端对应路径
 * 确保云端目录结构存在
 */
async function uploadFile(client: WebDAVClient, relativePath: string): Promise<void> {
  // 确保云端父目录存在
  const dirPath = relativePath.substring(0, relativePath.lastIndexOf('/'))
  if (dirPath) {
    await ensureRemoteDirectory(client, dirPath)
  }

  // 读取本地加密文件
  const localData = await readFile(relativePath)

  // 上传到 WebDAV
  const success = await client.putFileContents(
    `/${relativePath}`,
    localData,
    { overwrite: true }
  )

  if (!success) {
    throw new Error(`上传失败: ${relativePath}`)
  }
}

/**
 * 确保 WebDAV 远端目录存在（递归创建）
 */
async function ensureRemoteDirectory(client: WebDAVClient, dirPath: string): Promise<void> {
  const parts = dirPath.split('/').filter(Boolean)
  let currentPath = ''

  for (const part of parts) {
    currentPath += `/${part}`
    try {
      const exists = await client.exists(currentPath)
      if (!exists) {
        await client.createDirectory(currentPath)
      }
    } catch {
      // 目录可能已存在（并发创建导致），忽略
    }
  }
}

// ==================== 多网盘并行同步 ====================

/**
 * 并行同步多个云盘
 * 每个云盘完全独立，互不影响
 *
 * @param drives - 要同步的云盘列表（只同步已启用的）
 * @param onDriveProgress - 单个云盘进度回调
 * @param onLog - 日志回调
 */
export async function syncAllDrives(
  drives: CloudDriveConfig[],
  onDriveProgress?: (driveId: string, current: number, total: number, fileName: string) => void,
  onLog?: SyncLogCallback
): Promise<void> {
  const enabled = drives.filter((d) => d.enabled)
  if (enabled.length === 0) return

  // 并行执行所有云盘的同步
  await Promise.allSettled(
    enabled.map((drive) =>
      syncDrive(
        drive,
        (current, total, fileName) => {
          onDriveProgress?.(drive.id, current, total, fileName)
        },
        onLog
      )
    )
  )
}

// ==================== 从云端恢复数据 ====================

/**
 * 从云盘恢复数据到本地
 * 用于新设备首次登录或数据丢失后的恢复
 *
 * 恢复策略：
 * 1. 优先下载所有 .note 文件（文字内容）
 * 2. 不自动下载图片（按需加载：用户打开书时才下载该书图片）
 *
 * @param config - 云盘配置
 * @param onProgress - 进度回调
 */
export async function restoreFromCloud(
  config: CloudDriveConfig,
  onProgress?: SyncProgressCallback
): Promise<number> {
  let restored = 0

  try {
    const client = createWebDAVClient(config)

    // 拉取云端 manifest
    const manifest = await fetchRemoteManifest(client)
    if (!manifest) {
      throw new Error('云端未找到备份数据（manifest.json 不存在）')
    }

    // 过滤出 .note 文件
    const noteFiles = manifest.files.filter((f) => f.path.endsWith('.note'))
    const total = noteFiles.length

    for (let i = 0; i < noteFiles.length; i++) {
      const entry = noteFiles[i]
      onProgress?.(i + 1, total, entry.path)

      try {
        // 下载文件
        const content = await client.getFileContents(`/${entry.path}`, {
          format: 'binary',
        })

        // 确保本地目录存在
        const dirPath = entry.path.substring(0, entry.path.lastIndexOf('/'))
        if (dirPath) {
          const { createDirectory } = await import('./storage')
          await createDirectory(dirPath)
        }

        // 写入本地
        if (!(content instanceof ArrayBuffer)) {
          console.warn(`恢复文件格式异常: ${entry.path}`)
          continue
        }
        const fileData = new Uint8Array(content)
        await writeFile(entry.path, fileData)

        // 验证：文件内容是加密的，无法直接与明文哈希比较
        // 改为验证文件是否成功写入（大小 > 0）
        if (fileData.length > 0) {
          restored++
        } else {
          console.warn(`恢复文件为空: ${entry.path}`)
        }
      } catch (err) {
        console.error(`下载文件失败: ${entry.path}`, err)
        // 继续下载其他文件
      }
    }

    // 重建数据库索引
    // TODO: 调用 rebuildDatabase() 从下载的文件重建索引

    return restored
  } catch (err) {
    throw new Error(`从云端恢复失败: ${err instanceof Error ? err.message : String(err)}`)
  }
}

/**
 * 下载指定书的所有图片（按需加载）
 * 用户打开某本书时调用
 */
export async function downloadBookImages(
  config: CloudDriveConfig,
  bookId: string,
  onProgress?: SyncProgressCallback
): Promise<number> {
  let downloaded = 0

  try {
    const client = createWebDAVClient(config)
    const manifest = await fetchRemoteManifest(client)
    if (!manifest) return 0

    const bookImages = manifest.files.filter(
      (f) => f.path.startsWith(`Books/${bookId}/Assets/Images/`)
    )

    for (let i = 0; i < bookImages.length; i++) {
      const entry = bookImages[i]
      onProgress?.(i + 1, bookImages.length, entry.path)

      try {
        const exists = await fileExists(entry.path)
        if (exists) continue // 本地已有，跳过

        const content = await client.getFileContents(`/${entry.path}`, {
          format: 'binary',
        })

        // 确保目录存在
        const dirPath = `Books/${bookId}/Assets/Images`
        const { createDirectory } = await import('./storage')
        await createDirectory(dirPath)

        if (!(content instanceof ArrayBuffer)) {
          console.warn(`下载图片格式异常: ${entry.path}`)
          continue
        }
        await writeFile(entry.path, new Uint8Array(content))
        downloaded++
      } catch (err) {
        console.error(`下载图片失败: ${entry.path}`, err)
      }
    }

    return downloaded
  } catch (err) {
    throw new Error(`下载书籍图片失败: ${err instanceof Error ? err.message : String(err)}`)
  }
}
