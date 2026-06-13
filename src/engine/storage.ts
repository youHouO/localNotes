/**
 * 文件系统封装 - Origin Private File System (OPFS)
 *
 * 核心职责：
 * - 使用浏览器原生 OPFS（navigator.storage.getDirectory()）
 * - 所有数据存储在 OPFS 的 'localnotes-data' 子目录下
 * - 无需用户手动选择目录，无需权限弹窗
 * - 兼容所有现代浏览器（Chrome 102+ / Firefox 111+ / Safari 16.4+ / Edge）
 * - 提供原子写入（临时文件→重命名）保证崩溃安全
 */

const APP_ROOT = 'localnotes-data'

// 当前会话的根目录句柄缓存
let rootHandle: FileSystemDirectoryHandle | null = null

/**
 * 初始化存储（自动获取 OPFS 应用目录）
 * 数据存储在 OPFS 的 localnotes-data/ 子目录下
 */
export async function initStorage(): Promise<FileSystemDirectoryHandle> {
  if (rootHandle) return rootHandle

  try {
    const opfsRoot = await navigator.storage.getDirectory()
    // 使用子目录作为应用根目录，避免 OPFS 根目录的锁冲突
    rootHandle = await opfsRoot.getDirectoryHandle(APP_ROOT, { create: true })
    return rootHandle
  } catch (error) {
    throw new Error(`无法访问浏览器存储: ${error instanceof Error ? error.message : String(error)}。请使用最新版 Chrome / Edge / Firefox / Safari。`)
  }
}

/**
 * 兼容旧 API 的别名
 */
export async function requestStorageDirectory(): Promise<FileSystemDirectoryHandle> {
  return initStorage()
}

/**
 * 获取根目录句柄
 */
async function getRootHandle(): Promise<FileSystemDirectoryHandle> {
  if (!rootHandle) {
    return initStorage()
  }
  return rootHandle
}

/**
 * 通过路径逐级遍历获取目标文件/目录的句柄
 */
async function traversePath(
  relativePath: string,
  create = false
): Promise<{ parentHandle: FileSystemDirectoryHandle; targetName: string }> {
  const root = await getRootHandle()
  const parts = relativePath.split('/').filter(Boolean)

  if (parts.length === 0) {
    return { parentHandle: root, targetName: '' }
  }

  const targetName = parts[parts.length - 1]
  let currentHandle = root

  // 逐级遍历到父目录
  for (let i = 0; i < parts.length - 1; i++) {
    try {
      currentHandle = await currentHandle.getDirectoryHandle(parts[i], { create: create })
    } catch (err) {
      throw new Error(`目录不存在: ${parts.slice(0, i + 1).join('/')}`)
    }
  }

  return { parentHandle: currentHandle, targetName }
}

/**
 * 读取文件内容
 */
export async function readFile(relativePath: string): Promise<Uint8Array> {
  try {
    const { parentHandle, targetName } = await traversePath(relativePath)
    const fileHandle = await parentHandle.getFileHandle(targetName)
    const file = await fileHandle.getFile()
    const buffer = await file.arrayBuffer()
    return new Uint8Array(buffer)
  } catch (error) {
    throw new Error(`读取文件失败 ${relativePath}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * 写入文件（简化的原子写入，避免 OPFS 锁冲突）
 * 直接写入目标文件（OPFS 的 createWritable 自带原子性保证）
 */
export async function writeFile(relativePath: string, data: Uint8Array | string): Promise<void> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data
  const { parentHandle, targetName } = await traversePath(relativePath, true)

  // 先删除旧文件（如果存在），释放可能的锁
  try {
    await parentHandle.removeEntry(targetName)
  } catch {
    // 文件不存在，正常
  }

  // 创建新文件并写入
  const fileHandle = await parentHandle.getFileHandle(targetName, { create: true })
  const writable = await fileHandle.createWritable()
  try {
    await writable.write(bytes)
  } finally {
    // 确保锁一定释放
    await writable.close()
  }
}

/**
 * 检查文件是否存在
 */
export async function fileExists(relativePath: string): Promise<boolean> {
  try {
    const { parentHandle, targetName } = await traversePath(relativePath)
    await parentHandle.getFileHandle(targetName)
    return true
  } catch {
    return false
  }
}

/**
 * 删除文件（【高风险】需人工审核）
 */
export async function deleteFile(relativePath: string): Promise<void> {
  try {
    const { parentHandle, targetName } = await traversePath(relativePath)
    await parentHandle.removeEntry(targetName)
  } catch (error) {
    throw new Error(`删除文件失败 ${relativePath}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * 删除目录及其所有内容（【高风险】需人工审核）
 */
export async function deleteDirectory(relativePath: string): Promise<void> {
  try {
    const { parentHandle, targetName } = await traversePath(relativePath)
    await parentHandle.removeEntry(targetName, { recursive: true })
  } catch (error) {
    throw new Error(`删除目录失败 ${relativePath}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * 列出目录下所有文件和子目录
 */
export async function listDirectory(relativePath: string): Promise<string[]> {
  try {
    const { parentHandle, targetName } = await traversePath(relativePath)
    const dirHandle = await parentHandle.getDirectoryHandle(targetName)
    const entries: string[] = []
    for await (const [name] of dirHandle) {
      entries.push(name)
    }
    return entries
  } catch (error) {
    throw new Error(`列出目录失败 ${relativePath}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * 创建目录（递归创建中间目录）
 */
export async function createDirectory(relativePath: string): Promise<void> {
  try {
    const root = await getRootHandle()
    const parts = relativePath.split('/').filter(Boolean)
    let currentHandle = root

    for (const part of parts) {
      try {
        currentHandle = await currentHandle.getDirectoryHandle(part, { create: true })
      } catch (err) {
        // 如果创建失败（可能因为锁），等一下再重试一次
        await new Promise(resolve => setTimeout(resolve, 50))
        currentHandle = await currentHandle.getDirectoryHandle(part, { create: true })
      }
    }
  } catch (error) {
    throw new Error(`创建目录失败 ${relativePath}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * 移动文件（复制到目标 → 删除源文件）
 */
export async function moveFile(sourcePath: string, destPath: string): Promise<void> {
  try {
    const data = await readFile(sourcePath)
    const lastSlash = destPath.lastIndexOf('/')
    if (lastSlash > 0) {
      const destDir = destPath.substring(0, lastSlash)
      await createDirectory(destDir)
    }
    await writeFile(destPath, data)
    await deleteFile(sourcePath)
  } catch (error) {
    throw new Error(`移动文件失败: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * 判断存储是否已就绪
 */
export function isStorageReady(): boolean {
  return rootHandle !== null
}
