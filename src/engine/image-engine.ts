/**
 * 图片引擎 - 图片处理、压缩与同步协调
 *
 * 职责：
 * - 图片格式转换与压缩（→WebP，质量 95%）
 * - 图片本地存储管理
 * - 惰性同步队列管理（15秒延迟 + 批量合并）
 * - 退出时未同步图片提示
 */

import imageCompression from 'browser-image-compression'
import { writeFile, readFile, createDirectory } from './storage'
import { encrypt, decrypt } from './encryption'
import { getDB } from './database'
import { IMAGE_QUALITY, IMAGE_SYNC_DELAY } from '@/config'

/** 待同步图片队列 */
interface PendingImage {
  id: string
  bookId: string
  noteId: string
  localPath: string
  size: number
  addedAt: number
}

/** 同步队列（内存中） */
const pendingQueue: Map<string, PendingImage> = new Map()
let syncTimer: ReturnType<typeof setTimeout> | null = null
let onSyncCallback: ((images: PendingImage[]) => Promise<void>) | null = null

/**
 * 设置同步回调（由同步引擎注册）
 */
export function setImageSyncCallback(cb: (images: PendingImage[]) => Promise<void>): void {
  onSyncCallback = cb
}

/**
 * 获取未同步图片数量
 */
export function getPendingImageCount(): number {
  return pendingQueue.size
}

/**
 * 获取未同步图片总大小
 */
export function getPendingImageSize(): number {
  let total = 0
  pendingQueue.forEach((img) => { total += img.size })
  return total
}

/**
 * 获取所有待同步图片
 */
export function getPendingImages(): PendingImage[] {
  return Array.from(pendingQueue.values())
}

/**
 * 从待同步队列中移除图片（如被删除或替换）
 */
export function removePendingImage(imageId: string): void {
  pendingQueue.delete(imageId)
}

/**
 * 生成图片文件名
 * 格式：{时间戳}_{随机数}.webp
 */
function generateImageName(): string {
  const ts = Date.now()
  const rand = Math.random().toString(36).substring(2, 10)
  return `${ts}_${rand}.webp`
}

/**
 * 将图片转换为 WebP 格式并压缩
 * - 转换为 WebP（质量 95%）
 * - 去除 EXIF 信息和元数据
 * - 不牺牲人眼可感知的画质
 *
 * @param file - 原始图片文件或 Blob
 * @returns 压缩后的 WebP Blob
 */
export async function compressImage(file: File): Promise<Blob> {
  try {
    const compressed = await imageCompression(file, {
      maxSizeMB: 10,       // 最大 10MB
      maxWidthOrHeight: 4096, // 最大分辨率 4096px
      useWebWorker: true,  // 使用 Web Worker 避免阻塞 UI
      initialQuality: IMAGE_QUALITY,
      fileType: 'image/webp',
      alwaysKeepResolution: true,
      // 保留 EXIF 设为 false 以去除元数据
      exifOrientation: undefined,
    })
    return compressed
  } catch (error) {
    throw new Error(`图片压缩失败: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * 保存图片到本地文件系统（加密存储）
 *
 * @param bookId - 所属书 ID
 * @param imageBlob - 图片数据
 * @param noteId - 关联的笔记 ID（可选）
 * @returns 图片元数据
 */
export async function saveImage(
  bookId: string,
  imageBlob: Blob,
  noteId?: string
): Promise<{ id: string; localPath: string; size: number }> {
  try {
    const id = generateImageName()
    const localPath = `Books/${bookId}/Assets/Images/${id}`

    // 确保目录存在
    await createDirectory(`Books/${bookId}/Assets/Images`)

    // 将 Blob 转为 Uint8Array
    const buffer = await imageBlob.arrayBuffer()
    const data = new Uint8Array(buffer)

    // 加密图片数据
    const encrypted = await encrypt(data)

    // 写入本地文件
    await writeFile(localPath, encrypted)

    const size = encrypted.byteLength
    const timestamp = Date.now()

    // 写入 SQLite 索引
    const db = getDB()
    db.run(
      `INSERT INTO images (id, book_id, note_id, local_path, synced, created_at, size)
       VALUES (?, ?, ?, ?, 0, ?, ?)`,
      [id, bookId, noteId || null, localPath, timestamp, size]
    )

    return { id, localPath, size }
  } catch (error) {
    throw new Error(`保存图片失败: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * 加载图片（自动解密）
 * @param localPath - 图片本地路径
 * @returns 解密后的图片 Blob URL
 */
export async function loadImage(localPath: string): Promise<string> {
  try {
    const encrypted = await readFile(localPath)
    const decrypted = await decrypt(encrypted)
    const blob = new Blob([decrypted], { type: 'image/webp' })
    return URL.createObjectURL(blob)
  } catch (error) {
    throw new Error(`加载图片失败: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * 释放图片 Blob URL（防止内存泄漏）
 * @param url - 之前通过 loadImage 创建的 Blob URL
 */
export function revokeImageUrl(url: string): void {
  try { URL.revokeObjectURL(url) } catch { /* ignore */ }
}

/**
 * 将图片加入同步队列
 * 启动 15 秒延迟计时器，期间同批图片合并同步
 */
export function enqueueImageSync(image: PendingImage): void {
  // 覆盖同 ID 的旧任务
  if (pendingQueue.has(image.id)) {
    pendingQueue.delete(image.id)
  }

  pendingQueue.set(image.id, image)

  // 重置 15 秒计时器
  if (syncTimer) {
    clearTimeout(syncTimer)
  }

  syncTimer = setTimeout(() => {
    flushSyncQueue().catch((err) => {
      console.error('[ImageEngine] 惰性同步失败:', err)
    })
  }, IMAGE_SYNC_DELAY)
}

/**
 * 立即刷新同步队列（退出笔记时调用）
 */
export async function flushSyncQueue(): Promise<void> {
  if (syncTimer) {
    clearTimeout(syncTimer)
    syncTimer = null
  }

  if (pendingQueue.size === 0) return

  const images = Array.from(pendingQueue.values())
  pendingQueue.clear()

  if (onSyncCallback) {
    try {
      await onSyncCallback(images)
      // 同步成功后更新数据库 synced 标记
      const db = getDB()
      for (const img of images) {
        db.run('UPDATE images SET synced = 1 WHERE id = ?', [img.id])
      }
    } catch (error) {
      // 同步失败，重新加入队列
      console.error('图片同步失败:', error)
      for (const img of images) {
        pendingQueue.set(img.id, img)
      }
    }
  }
}

/**
 * 获取某本书记记下所有图片
 */
export function listBookImages(bookId: string): Array<{
  id: string
  noteId: string | null
  localPath: string
  synced: boolean
  size: number
}> {
  try {
    const db = getDB()
    const results = db.exec(
      'SELECT id, note_id, local_path, synced, size FROM images WHERE book_id = ?',
      [bookId]
    )
    if (!results.length) return []

    const cols = results[0].columns
    return results[0].values.map((row) => {
      const r: Record<string, unknown> = {}
      cols.forEach((c, i) => { r[c] = row[i] })
      return {
        id: r.id as string,
        noteId: r.note_id as string | null,
        localPath: r.local_path as string,
        synced: !!(r.synced as number),
        size: r.size as number,
      }
    })
  } catch (err) {
    console.error('[ImageEngine] 获取图片列表失败:', err)
    return []
  }
}
