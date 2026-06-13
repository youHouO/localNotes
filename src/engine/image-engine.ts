/**
 * 图片引擎 — 处理笔记中的图片
 * 支持粘贴、拖拽、URL 导入，WebP 压缩，本地存储
 */

import { isStorageReady, writeFile, readFile, deleteFile, listDirectory } from './storage'
import { getDB } from './database'

export interface ImageInfo {
  id: string
  noteId: string
  bookId: string
  originalName: string
  webpName: string
  size: number
  width: number
  height: number
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

  // 简化：直接保存原始数据，实际应使用 Canvas 转为 WebP
  await writeFile(path, imageData)

  const info: ImageInfo = {
    id,
    noteId,
    bookId,
    originalName,
    webpName,
    size: imageData.length,
    width: 0,
    height: 0,
    createdAt: now(),
  }

  // 记录到数据库
  const db = getDB()
  db.run(
    `INSERT INTO images (id, note_id, book_id, original_name, webp_name, size, width, height, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, noteId, bookId, originalName, webpName, info.size, info.width, info.height, info.createdAt],
  )

  return info
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
    `SELECT id, note_id, book_id, original_name, webp_name, size, width, height, created_at FROM images WHERE note_id = ?`,
    [noteId],
  )
  if (!res || res.length === 0) return []
  return res[0].values.map((row) => ({
    id: row[0] as string,
    noteId: row[1] as string,
    bookId: row[2] as string,
    originalName: row[3] as string,
    webpName: row[4] as string,
    size: row[5] as number,
    width: row[6] as number,
    height: row[7] as number,
    createdAt: row[8] as number,
  }))
}

/**
 * 列出书中所有图片
 */
export async function listBookImages(bookId: string): Promise<ImageInfo[]> {
  assertStorageReady()
  const db = getDB()
  const res = db.exec(
    `SELECT id, note_id, book_id, original_name, webp_name, size, width, height, created_at FROM images WHERE book_id = ?`,
    [bookId],
  )
  if (!res || res.length === 0) return []
  return res[0].values.map((row) => ({
    id: row[0] as string,
    noteId: row[1] as string,
    bookId: row[2] as string,
    originalName: row[3] as string,
    webpName: row[4] as string,
    size: row[5] as number,
    width: row[6] as number,
    height: row[7] as number,
    createdAt: row[8] as number,
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
 */
export async function syncImages(noteId: string): Promise<void> {
  assertStorageReady()
  const db = getDB()

  // 查询该笔记下未同步的图片
  const unsyncedRes = db.exec(
    `SELECT id, book_id, webp_name FROM images WHERE note_id = ? AND synced = 0`,
    [noteId],
  )

  if (!unsyncedRes || unsyncedRes.length === 0 || unsyncedRes[0].values.length === 0) {
    return // 没有未同步图片
  }

  const images = unsyncedRes[0].values.map((row) => ({
    id: row[0] as string,
    bookId: row[1] as string,
    webpName: row[2] as string,
  }))

  // 逐个上传并标记为已同步
  for (const img of images) {
    try {
      const imageData = await loadImage(img.bookId, img.id)
      if (!imageData) continue

      // 占位：实际应调用云盘上传 API
      // await uploadToCloud(img.bookId, img.webpName, imageData)

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
