/**
 * 图片引擎 — 处理笔记中的图片
 * 支持粘贴、拖拽、URL 导入，WebP 压缩，本地存储
 */

import { isStorageReady, writeFile, readFile, deleteFile, listDirectory } from './storage'
import { getDB } from './database'
import { uploadFile } from './sync-engine'
import type { SyncConfig } from './sync-engine'
import imageCompression from 'browser-image-compression'

export interface ImageInfo {
  id: string
  noteId: string
  bookId: string
  localPath: string
  size: number
  createdAt: number
}

function assertStorageReady() {
  if (!isStorageReady()) throw new Error('存储未初始化')
}

function generateId(): string {
  return crypto.randomUUID()
}

function now(): number {
  return Date.now()
}

/**
 * 将图片数据压缩为 WebP 并保存
 */
export async function saveImage(
  bookId: string,
  noteId: string,
  imageData: Uint8Array,
  originalName: string,
): Promise<ImageInfo> {
  assertStorageReady()

  const id = generateId()
  const webpName = `${id}.webp`
  const path = `Books/${bookId}/Assets/Images/${webpName}`
  const localPath = path

  let finalData: Uint8Array

  try {
    const compressed = await compressImage(imageData)
    finalData = compressed.data
  } catch {
    // 压缩失败（如非图片数据），降级为直接保存原始数据
    finalData = imageData
  }

  await writeFile(path, finalData)

  const info: ImageInfo = {
    id,
    noteId,
    bookId,
    localPath,
    size: finalData.length,
    createdAt: now(),
  }

  // 记录到数据库
  const db = getDB()
  db.run(
    `INSERT INTO images (id, note_id, book_id, local_path, size, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    [id, noteId, bookId, localPath, info.size, info.createdAt],
  )

  return info
}

/**
 * 压缩图片为 WebP 格式
 * @param input 原始图片数据（Uint8Array 或 File）
 * @returns 压缩后的数据及图片尺寸
 */
export async function compressImage(
  input: Uint8Array | File,
): Promise<{ data: Uint8Array; width: number; height: number }> {
  // 将输入统一转为 File 对象
  const file = input instanceof File
    ? input
    : new File([input], 'image', { type: 'image/*' })

  // 使用 browser-image-compression 压缩
  const compressedFile = await imageCompression(file, {
    maxWidth: 1920,
    maxHeight: 1920,
    maxSizeMB: 1,
    fileType: 'image/webp' as string,
    initialQuality: 0.8,
  })

  // 将压缩后的 Blob 转为 Uint8Array
  const compressedData = new Uint8Array(await compressedFile.arrayBuffer())

  // 使用 canvas 获取图片尺寸
  const img = new Image()
  const objectUrl = URL.createObjectURL(compressedFile)
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error('无法加载图片'))
    img.src = objectUrl
  })
  const width = img.naturalWidth
  const height = img.naturalHeight
  URL.revokeObjectURL(objectUrl)

  return { data: compressedData, width, height }
}

/**
 * 读取图片数据
 */
export async function loadImage(bookId: string, imageId: string): Promise<Uint8Array | null> {
  assertStorageReady()
  const path = `Books/${bookId}/Assets/Images/${imageId}.webp`
  return readFile(path)
}

/**
 * 删除图片
 */
export async function deleteImage(bookId: string, imageId: string): Promise<void> {
  assertStorageReady()
  const path = `Books/${bookId}/Assets/Images/${imageId}.webp`
  await deleteFile(path)

  const db = getDB()
  db.run(`DELETE FROM images WHERE id = ?`, [imageId])
}

/**
 * 列出笔记关联的图片
 */
export function listNoteImages(noteId: string): ImageInfo[] {
  assertStorageReady()
  const db = getDB()
  const res = db.exec(
    `SELECT id, note_id, book_id, local_path, size, created_at FROM images WHERE note_id = ?`,
    [noteId],
  )
  if (!res || res.length === 0) return []
  return res[0].values.map((row) => ({
    id: row[0] as string,
    noteId: row[1] as string,
    bookId: row[2] as string,
    localPath: row[3] as string,
    size: row[4] as number,
    createdAt: row[5] as number,
  }))
}

/**
 * 列出书中所有图片
 */
export async function listBookImages(bookId: string): Promise<ImageInfo[]> {
  assertStorageReady()
  const db = getDB()
  const res = db.exec(
    `SELECT id, note_id, book_id, local_path, size, created_at FROM images WHERE book_id = ?`,
    [bookId],
  )
  if (!res || res.length === 0) return []
  return res[0].values.map((row) => ({
    id: row[0] as string,
    noteId: row[1] as string,
    bookId: row[2] as string,
    localPath: row[3] as string,
    size: row[4] as number,
    createdAt: row[5] as number,
  }))
}

/**
 * 释放图片 URL（防止内存泄漏）
 */
export function revokeImageUrl(url: string): void {
  if (url.startsWith('blob:')) {
    URL.revokeObjectURL(url)
  }
}

/**
 * 提前同步图片（在退出笔记前调用）
 * 检查未同步图片并上传到云盘
 * @param noteId 笔记ID
 * @param config 可选的同步配置，不传则只标记本地状态（用于离线模式）
 */
export async function syncImages(noteId: string, config?: SyncConfig): Promise<void> {
  assertStorageReady()
  const db = getDB()

  // 查询该笔记下未同步的图片
  const unsyncedRes = db.exec(
    `SELECT id, book_id, local_path FROM images WHERE note_id = ? AND synced = 0`,
    [noteId],
  )

  if (!unsyncedRes || unsyncedRes.length === 0 || unsyncedRes[0].values.length === 0) {
    return // 没有未同步图片
  }

  const images = unsyncedRes[0].values.map((row) => ({
    id: row[0] as string,
    bookId: row[1] as string,
    localPath: row[2] as string,
  }))

  // 逐个上传并标记为已同步
  for (const img of images) {
    try {
      const imageData = await loadImage(img.bookId, img.id)
      if (!imageData) continue

      // 如果有同步配置，实际上传到云盘
      if (config) {
        const localPath = img.localPath
        const fileName = localPath.split('/').pop() ?? img.id
        const remoteSubPath = `images/${fileName}`
        const uploaded = await uploadFile(config, localPath, remoteSubPath)
        if (!uploaded) {
          console.warn(`图片上传失败，跳过标记: ${img.id}`)
          continue // 上传失败不标记为已同步
        }
      }

      // 标记为已同步
      db.run(`UPDATE images SET synced = 1, synced_at = ? WHERE id = ?`, [now(), img.id])
    } catch (err) {
      console.warn(`图片同步失败: ${img.id}`, err)
      // 继续同步其他图片，不阻断
    }
  }
}

/**
 * 获取未同步图片数量
 */
export function getUnsyncedImageCount(noteId: string): number {
  assertStorageReady()
  const db = getDB()
  const res = db.exec(
    `SELECT COUNT(*) as count FROM images WHERE note_id = ? AND synced = 0`,
    [noteId],
  )
  if (!res || res.length === 0 || res[0].values.length === 0) return 0
  return res[0].values[0][0] as number
}
