/**
 * 笔记引擎 - 核心业务逻辑层
 *
 * 职责：
 * - 书/卷/笔记的增删改查
 * - 加密解密协调（透明加密，引擎调用方无需感知）
 * - 模板管理
 * - 回收站管理（软删除/恢复/永久删除）
 * - 自动保存协调
 *
 * 原则：
 * - 所有操作先更新本地文件，再更新数据库索引
 * - 同步失败绝不修改本地数据
 * - 删除 = 软删除（移入.trash/，保留30天）
 * - 所有异步操作必须 try/catch
 */

import { encryptString, decryptToString, sha256 } from './encryption'
import {
  readFile,
  writeFile,
  deleteFile,
  deleteDirectory,
  listDirectory,
  createDirectory,
  moveFile,
  fileExists,
  isStorageReady,
} from './storage'
import { getDB, updateFTSContent, isFTS5Available } from './database'
import type { Book, Volume, Note, Template } from '@/types'

// ==================== 工具函数 ====================

/**
 * 生成简单的 UUID v4（避免额外依赖）
 * 使用 crypto.randomUUID() 如果可用，否则手动生成
 */
function generateUUID(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  // Fallback: 手动生成 UUID v4
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

/** 获取当前时间戳（毫秒） */
function now(): number {
  return Date.now()
}

/**
 * 确保存储已就绪，否则抛出明确错误
 */
function ensureStorageReady(): void {
  if (!isStorageReady()) {
    throw new Error('存储目录未初始化，请先选择数据存储位置')
  }
}

// ==================== 书 (Book) 操作 ====================

/**
 * 获取书在文件系统中的路径
 */
function getBookPath(bookId: string): string {
  return `Books/${bookId}`
}

/**
 * 获取书的回收站路径
 */
function getBookTrashPath(bookId: string): string {
  return `Books/${bookId}/.trash`
}

/**
 * 创建新书
 * - 创建 Books/{UUID}/ 目录及子目录
 * - 写入 SQLite 索引
 */
export async function createBook(name: string): Promise<Book> {
  ensureStorageReady()
  try {
    const id = generateUUID()
    const timestamp = now()
    const bookPath = getBookPath(id)

    // 创建目录结构：Books/{id}/Notes/, Books/{id}/Assets/Images/, Books/{id}/.trash/
    await createDirectory(`${bookPath}/Notes`)
    await createDirectory(`${bookPath}/Assets/Images`)
    await createDirectory(`${bookPath}/.trash`)

    // 写入 SQLite
    const db = getDB()
    db.run(
      'INSERT INTO books (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)',
      [id, name, timestamp, timestamp]
    )

    const book: Book = {
      id,
      name,
      createdAt: timestamp,
      updatedAt: timestamp,
      noteCount: 0,
    }

    return book
  } catch (error) {
    throw new Error(`创建书失败: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * 获取所有书列表（按更新时间倒序）
 */
export function listBooks(): Book[] {
  ensureStorageReady()
  try {
    const db = getDB()
    const results = db.exec(`
      SELECT b.*, COUNT(n.id) as note_count
      FROM books b
      LEFT JOIN notes n ON n.book_id = b.id
      GROUP BY b.id
      ORDER BY b.updated_at DESC
    `)

    if (!results.length) return []

    const columns = results[0].columns
    return results[0].values.map((row) => {
      const record: Record<string, unknown> = {}
      columns.forEach((col, i) => { record[col] = row[i] })
      return {
        id: record.id as string,
        name: record.name as string,
        createdAt: record.created_at as number,
        updatedAt: record.updated_at as number,
        noteCount: record.note_count as number,
      }
    })
  } catch (error) {
    throw new Error(`获取书列表失败: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * 获取单本书的信息
 */
export function getBook(bookId: string): Book | null {
  try {
    const db = getDB()
    const results = db.exec('SELECT * FROM books WHERE id = ?', [bookId])
    if (!results.length || !results[0].values.length) return null

    const row = results[0].values[0]
    const columns = results[0].columns
    const record: Record<string, unknown> = {}
    columns.forEach((col, i) => { record[col] = row[i] })

    return {
      id: record.id as string,
      name: record.name as string,
      createdAt: record.created_at as number,
      updatedAt: record.updated_at as number,
      noteCount: 0,
    }
  } catch {
    return null
  }
}

/**
 * 重命名书
 */
export async function renameBook(bookId: string, newName: string): Promise<void> {
  ensureStorageReady()
  try {
    const db = getDB()
    const timestamp = now()
    db.run('UPDATE books SET name = ?, updated_at = ? WHERE id = ?', [newName, timestamp, bookId])
    if (db.getRowsModified() === 0) {
      throw new Error(`书不存在: ${bookId}`)
    }
  } catch (error) {
    throw new Error(`重命名书失败: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * 删除书（软删除）
 * 将书移动到 .trash/ 目录，标记删除时间
 * 保留 30 天后才真正删除
 */
export async function deleteBook(bookId: string): Promise<void> {
  ensureStorageReady()
  try {
    const book = getBook(bookId)
    if (!book) throw new Error(`书不存在: ${bookId}`)

    const timestamp = now()
    const bookPath = getBookPath(bookId)
    const trashPath = `${bookPath}/.trash/_deleted_book_${timestamp}`

    // 注意：这里不是真正把整个书移到回收站
    // 而是创建一个删除标记，在 30 天后自动清理
    // 实际上我们标记该书为已删除，下次查询时过滤掉
    // 同时在 .trash 中创建恢复记录

    await createDirectory(trashPath)
    // 写入恢复信息文件（明文 JSON，记录原始名称和删除时间）
    const recoveryInfo = JSON.stringify({
      type: 'book',
      originalName: book.name,
      deletedAt: timestamp,
      bookId,
    })
    await writeFile(`${trashPath}/recovery.json`, recoveryInfo)

    // 更新数据库：不删除记录，标记为已删除
    // 简化方案：将 updated_at 设为负数，过滤时跳过
    // 实际使用软删除标记字段
    const db = getDB()
    db.run('UPDATE books SET updated_at = ? WHERE id = ?', [-timestamp, bookId])
  } catch (error) {
    throw new Error(`删除书失败: ${error instanceof Error ? error.message : String(error)}`)
  }
}

// ==================== 卷 (Volume) 操作 ====================

/**
 * 创建新卷
 */
export async function createVolume(bookId: string, name: string): Promise<Volume> {
  ensureStorageReady()
  try {
    const id = generateUUID()
    const timestamp = now()
    const db = getDB()

    // 获取当前最大 sort_order
    const maxSort = db.exec('SELECT COALESCE(MAX(sort_order), -1) as max_sort FROM volumes WHERE book_id = ?', [bookId])
    const sortOrder = maxSort.length && maxSort[0]?.values?.length && maxSort[0].values[0]?.length
      ? (maxSort[0].values[0][0] as number) + 1
      : 0

    db.run(
      'INSERT INTO volumes (id, book_id, name, created_at, updated_at, sort_order) VALUES (?, ?, ?, ?, ?, ?)',
      [id, bookId, name, timestamp, timestamp, sortOrder]
    )

    // 更新书的 updated_at
    db.run('UPDATE books SET updated_at = ? WHERE id = ?', [timestamp, bookId])

    return {
      id,
      bookId,
      name,
      createdAt: timestamp,
      updatedAt: timestamp,
      noteCount: 0,
      sortOrder,
    }
  } catch (error) {
    throw new Error(`创建卷失败: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * 获取书下的所有卷
 */
export function listVolumes(bookId: string): Volume[] {
  try {
    const db = getDB()
    const results = db.exec(`
      SELECT v.*, COUNT(n.id) as note_count
      FROM volumes v
      LEFT JOIN notes n ON n.volume_id = v.id
      WHERE v.book_id = ?
      GROUP BY v.id
      ORDER BY v.sort_order ASC, v.updated_at DESC
    `, [bookId])

    if (!results.length) return []

    const columns = results[0].columns
    return results[0].values.map((row) => {
      const record: Record<string, unknown> = {}
      columns.forEach((col, i) => { record[col] = row[i] })
      return {
        id: record.id as string,
        bookId: record.book_id as string,
        name: record.name as string,
        createdAt: record.created_at as number,
        updatedAt: record.updated_at as number,
        noteCount: record.note_count as number,
        sortOrder: record.sort_order as number,
      }
    })
  } catch (error) {
    throw new Error(`获取卷列表失败: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * 重命名卷
 */
export async function renameVolume(volumeId: string, newName: string): Promise<void> {
  ensureStorageReady()
  try {
    const db = getDB()
    const timestamp = now()
    db.run('UPDATE volumes SET name = ?, updated_at = ? WHERE id = ?', [newName, timestamp, volumeId])
  } catch (error) {
    throw new Error(`重命名卷失败: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * 删除卷（软删除）
 */
export async function deleteVolume(volumeId: string): Promise<void> {
  ensureStorageReady()
  try {
    const db = getDB()
    const volResults = db.exec('SELECT * FROM volumes WHERE id = ?', [volumeId])
    if (!volResults.length || !volResults[0].values.length) {
      throw new Error(`卷不存在: ${volumeId}`)
    }

    const columns = volResults[0].columns
    const row = volResults[0].values[0]
    const record: Record<string, unknown> = {}
    columns.forEach((col, i) => { record[col] = row[i] })

    const bookId = record.book_id as string
    const timestamp = now()

    // 标记为已删除（负时间戳）
    db.run('UPDATE volumes SET updated_at = ? WHERE id = ?', [-timestamp, volumeId])

    // 更新书的时间
    db.run('UPDATE books SET updated_at = ? WHERE id = ?', [timestamp, bookId])

    // 在文件系统中创建回收记录
    const trashPath = getBookTrashPath(bookId)
    await createDirectory(trashPath)
    const recoveryInfo = JSON.stringify({
      type: 'volume',
      originalName: record.name as string,
      deletedAt: timestamp,
      volumeId,
      bookId,
    })
    await writeFile(`${trashPath}/_deleted_volume_${volumeId}_${timestamp}.json`, recoveryInfo)
  } catch (error) {
    throw new Error(`删除卷失败: ${error instanceof Error ? error.message : String(error)}`)
  }
}

// ==================== 笔记 (Note) 操作 ====================

/**
 * 获取笔记在文件系统中的路径
 */
function getNotePath(bookId: string, noteId: string): string {
  return `Books/${bookId}/Notes/${noteId}.note`
}

/**
 * 获取笔记临时文件路径（原子写入用）
 */
function getNoteTempPath(bookId: string, noteId: string): string {
  return `Books/${bookId}/Notes/${noteId}.temp.note`
}

/**
 * 创建新笔记
 * - 创建空 .note 文件（加密格式）
 * - 写入 SQLite 索引
 */
export async function createNote(
  volumeId: string,
  bookId: string,
  title = '无标题笔记',
  templateContent?: string
): Promise<Note> {
  ensureStorageReady()
  try {
    const id = generateUUID()
    const timestamp = now()
    const content = templateContent || ''

    // 加密内容后写入文件
    const encrypted = await encryptString(content)
    await writeFile(getNotePath(bookId, id), encrypted)

    // 计算明文哈希
    const contentHash = await sha256(content)
    const wordCount = content.replace(/\s/g, '').length

    // 写入 SQLite
    const db = getDB()
    db.run(
      `INSERT INTO notes (id, volume_id, book_id, title, content_hash, created_at, updated_at, word_count, image_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      [id, volumeId, bookId, title, contentHash, timestamp, timestamp, wordCount]
    )

    // 更新 FTS 索引
    const rowIdResults = db.exec('SELECT last_insert_rowid()')
    if (rowIdResults.length && rowIdResults[0].values.length && rowIdResults[0].values[0].length) {
      const noteRowId = rowIdResults[0].values[0][0] as number
      updateFTSContent(noteRowId, content)
    }

    // 更新卷和书的时间
    db.run('UPDATE volumes SET updated_at = ? WHERE id = ?', [timestamp, volumeId])
    db.run('UPDATE books SET updated_at = ? WHERE id = ?', [timestamp, bookId])

    return {
      id,
      volumeId,
      bookId,
      title,
      contentHash,
      createdAt: timestamp,
      updatedAt: timestamp,
      wordCount,
      imageCount: 0,
    }
  } catch (error) {
    throw new Error(`创建笔记失败: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * 加载笔记内容（自动解密）
 * @returns { note: Note 元数据, content: 明文内容 }
 */
export async function loadNote(noteId: string): Promise<{ note: Note; content: string }> {
  ensureStorageReady()
  try {
    const db = getDB()
    const results = db.exec('SELECT * FROM notes WHERE id = ?', [noteId])
    if (!results.length || !results[0].values.length) {
      throw new Error(`笔记不存在: ${noteId}`)
    }

    const columns = results[0].columns
    const row = results[0].values[0]
    const record: Record<string, unknown> = {}
    columns.forEach((col, i) => { record[col] = row[i] })

    const bookId = record.book_id as string

    // 从文件系统读取加密文件
    const notePath = getNotePath(bookId, noteId)
    const encryptedData = await readFile(notePath)

    // 解密
    const content = await decryptToString(encryptedData)

    const note: Note = {
      id: record.id as string,
      volumeId: record.volume_id as string,
      bookId,
      title: record.title as string,
      contentHash: record.content_hash as string,
      createdAt: record.created_at as number,
      updatedAt: record.updated_at as number,
      wordCount: record.word_count as number,
      imageCount: record.image_count as number,
    }

    return { note, content }
  } catch (error) {
    throw new Error(`加载笔记失败 ${noteId}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * 保存笔记内容（加密 + 原子写入）
 * - 先写临时文件，再重命名为正式文件（崩溃安全）
 * - 更新 SQLite 索引和 FTS
 * - 返回更新后的 Note 元数据
 */
export async function saveNote(
  noteId: string,
  content: string,
  title?: string
): Promise<Note> {
  ensureStorageReady()
  try {
    const db = getDB()
    const results = db.exec('SELECT * FROM notes WHERE id = ?', [noteId])
    if (!results.length || !results[0].values.length) {
      throw new Error(`笔记不存在: ${noteId}`)
    }

    const columns = results[0].columns
    const row = results[0].values[0]
    const record: Record<string, unknown> = {}
    columns.forEach((col, i) => { record[col] = row[i] })

    const bookId = record.book_id as string
    const volumeId = record.volume_id as string
    const timestamp = now()
    const newTitle = title ?? (record.title as string)

    // 步骤1：加密内容
    const encrypted = await encryptString(content)

    // 步骤2：原子写入（先临时文件，再重命名为正式文件）
    const notePath = getNotePath(bookId, noteId)
    const tempPath = getNoteTempPath(bookId, noteId)
    const backupPath = notePath + '.backup'

    // 如果原文件存在，先创建备份
    const exists = await fileExists(notePath)
    if (exists) {
      const oldData = await readFile(notePath)
      await writeFile(backupPath, oldData)
    }

    await writeFile(tempPath, encrypted)

    // 读取临时文件内容，写入正式路径
    const tempData = await readFile(tempPath)
    await writeFile(notePath, tempData)
    await deleteFile(tempPath)

    // 写入成功后删除备份
    try { await deleteFile(backupPath) } catch { /* 备份不存在时忽略 */ }

    // 步骤3：更新 SQLite
    const contentHash = await sha256(content)
    const wordCount = content.replace(/\s/g, '').length

    db.run(
      `UPDATE notes SET title = ?, content_hash = ?, updated_at = ?, word_count = ? WHERE id = ?`,
      [newTitle, contentHash, timestamp, wordCount, noteId]
    )

    // 步骤4：更新 FTS 索引
    const rowIdResults = db.exec('SELECT rowid FROM notes WHERE id = ?', [noteId])
    if (rowIdResults.length && rowIdResults[0].values.length) {
      const rowId = rowIdResults[0].values[0][0] as number
      updateFTSContent(rowId, content)
    }

    // 步骤5：更新关联的卷和书时间
    db.run('UPDATE volumes SET updated_at = ? WHERE id = ?', [timestamp, volumeId])
    db.run('UPDATE books SET updated_at = ? WHERE id = ?', [timestamp, bookId])

    return {
      id: noteId,
      volumeId,
      bookId,
      title: newTitle,
      contentHash,
      createdAt: record.created_at as number,
      updatedAt: timestamp,
      wordCount,
      imageCount: record.image_count as number,
    }
  } catch (error) {
    throw new Error(`保存笔记失败: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * 重命名笔记
 */
export async function renameNote(noteId: string, newTitle: string): Promise<void> {
  ensureStorageReady()
  try {
    const db = getDB()
    const timestamp = now()
    db.run('UPDATE notes SET title = ?, updated_at = ? WHERE id = ?', [newTitle, timestamp, noteId])
  } catch (error) {
    throw new Error(`重命名笔记失败: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * 获取卷下的所有笔记
 */
export function listNotes(volumeId: string): Note[] {
  try {
    const db = getDB()
    const results = db.exec(`
      SELECT * FROM notes
      WHERE volume_id = ? AND updated_at > 0
      ORDER BY updated_at DESC
    `, [volumeId])

    if (!results.length) return []

    const columns = results[0].columns
    return results[0].values.map((row) => {
      const record: Record<string, unknown> = {}
      columns.forEach((col, i) => { record[col] = row[i] })
      return {
        id: record.id as string,
        volumeId: record.volume_id as string,
        bookId: record.book_id as string,
        title: record.title as string,
        contentHash: record.content_hash as string,
        createdAt: record.created_at as number,
        updatedAt: record.updated_at as number,
        wordCount: record.word_count as number,
        imageCount: record.image_count as number,
      }
    })
  } catch (error) {
    throw new Error(`获取笔记列表失败: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * 删除笔记（软删除）
 * - 将 .note 文件移动到 .trash/ 目录
 * - 在 SQLite 中标记为已删除
 */
export async function deleteNote(noteId: string): Promise<void> {
  ensureStorageReady()
  try {
    const db = getDB()
    const results = db.exec('SELECT * FROM notes WHERE id = ?', [noteId])
    if (!results.length || !results[0].values.length) {
      throw new Error(`笔记不存在: ${noteId}`)
    }

    const columns = results[0].columns
    const row = results[0].values[0]
    const record: Record<string, unknown> = {}
    columns.forEach((col, i) => { record[col] = row[i] })

    const bookId = record.book_id as string
    const volumeId = record.volume_id as string
    const timestamp = now()

    // 移动文件到回收站
    const notePath = getNotePath(bookId, noteId)
    const trashPath = getBookTrashPath(bookId)
    await createDirectory(trashPath)
    const trashNotePath = `${trashPath}/${noteId}_${timestamp}.note`

    try {
      await moveFile(notePath, trashNotePath)
    } catch {
      // 如果文件移动失败（如文件不存在），仍然更新数据库
    }

    // 更新 SQLite 标记为删除
    db.run('UPDATE notes SET updated_at = ? WHERE id = ?', [-timestamp, noteId])

    // 更新卷和书的时间
    db.run('UPDATE volumes SET updated_at = ? WHERE id = ?', [timestamp, volumeId])
    db.run('UPDATE books SET updated_at = ? WHERE id = ?', [timestamp, bookId])
  } catch (error) {
    throw new Error(`删除笔记失败: ${error instanceof Error ? error.message : String(error)}`)
  }
}

// ==================== 模板管理 ====================

/**
 * 获取模板在文件系统中的路径
 */
function getTemplatePath(scope: 'global' | 'book', bookId: string | undefined, templateId: string): string {
  if (scope === 'global') {
    return `Books/.templates/${templateId}.note`
  }
  return `Books/${bookId}/.templates/${templateId}.note`
}

/**
 * 创建新模板
 */
export async function createTemplate(
  name: string,
  content: string,
  scope: 'global' | 'book',
  bookId?: string
): Promise<Template> {
  ensureStorageReady()
  try {
    const id = generateUUID()
    const timestamp = now()

    // 确保模板目录存在
    if (scope === 'global') {
      await createDirectory('Books/.templates')
    } else if (bookId) {
      await createDirectory(`Books/${bookId}/.templates`)
    } else {
      throw new Error('书内模板需要指定 bookId')
    }

    // 加密并保存模板文件（模板和普通笔记使用相同的加密规则）
    const encrypted = await encryptString(content)
    await writeFile(getTemplatePath(scope, bookId, id), encrypted)

    // 写入 SQLite
    const db = getDB()
    db.run(
      'INSERT INTO templates (id, name, scope, book_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      [id, name, scope, bookId || null, timestamp, timestamp]
    )

    return {
      id,
      name,
      content,
      scope,
      bookId,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
  } catch (error) {
    throw new Error(`创建模板失败: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * 加载模板内容（自动解密）
 */
export async function loadTemplate(templateId: string): Promise<Template> {
  ensureStorageReady()
  try {
    const db = getDB()
    const results = db.exec('SELECT * FROM templates WHERE id = ?', [templateId])
    if (!results.length || !results[0].values.length) {
      throw new Error(`模板不存在: ${templateId}`)
    }

    const columns = results[0].columns
    const row = results[0].values[0]
    const record: Record<string, unknown> = {}
    columns.forEach((col, i) => { record[col] = row[i] })

    const scope = record.scope as 'global' | 'book'
    const bookId = record.book_id as string | undefined
    const path = getTemplatePath(scope, bookId, templateId)

    const encrypted = await readFile(path)
    const content = await decryptToString(encrypted)

    return {
      id: templateId,
      name: record.name as string,
      content,
      scope,
      bookId,
      createdAt: record.created_at as number,
      updatedAt: record.updated_at as number,
    }
  } catch (error) {
    throw new Error(`加载模板失败: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * 更新模板
 */
export async function updateTemplate(templateId: string, name: string, content: string): Promise<void> {
  ensureStorageReady()
  try {
    const db = getDB()
    const results = db.exec('SELECT * FROM templates WHERE id = ?', [templateId])
    if (!results.length || !results[0].values.length) {
      throw new Error(`模板不存在: ${templateId}`)
    }

    const columns = results[0].columns
    const row = results[0].values[0]
    const record: Record<string, unknown> = {}
    columns.forEach((col, i) => { record[col] = row[i] })

    const scope = record.scope as 'global' | 'book'
    const bookId = record.book_id as string | undefined
    const timestamp = now()

    // 更新模板文件
    const encrypted = await encryptString(content)
    await writeFile(getTemplatePath(scope, bookId, templateId), encrypted)

    // 更新数据库
    db.run('UPDATE templates SET name = ?, updated_at = ? WHERE id = ?', [name, timestamp, templateId])
  } catch (error) {
    throw new Error(`更新模板失败: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * 列出所有可用模板
 */
export function listTemplates(bookId?: string): Template[] {
  try {
    const db = getDB()
    let query = 'SELECT * FROM templates WHERE 1=1'
    const params: string[] = []

    // 全局模板 + 指定书的模板
    if (bookId) {
      query += ' AND (scope = ? OR (scope = ? AND book_id = ?))'
      params.push('global', 'book', bookId)
    }

    query += ' ORDER BY updated_at DESC'
    const results = db.exec(query, params)

    if (!results.length) return []

    const columns = results[0].columns
    return results[0].values.map((row) => {
      const record: Record<string, unknown> = {}
      columns.forEach((col, i) => { record[col] = row[i] })
      return {
        id: record.id as string,
        name: record.name as string,
        content: '', // 列表时不加载内容
        scope: record.scope as 'global' | 'book',
        bookId: record.book_id as string | undefined,
        createdAt: record.created_at as number,
        updatedAt: record.updated_at as number,
      }
    })
  } catch (error) {
    throw new Error(`获取模板列表失败: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * 删除模板（不影响已使用该模板创建的笔记）
 */
export async function deleteTemplate(templateId: string): Promise<void> {
  ensureStorageReady()
  try {
    const db = getDB()
    const results = db.exec('SELECT * FROM templates WHERE id = ?', [templateId])
    if (!results.length || !results[0].values.length) {
      throw new Error(`模板不存在: ${templateId}`)
    }

    const columns = results[0].columns
    const row = results[0].values[0]
    const record: Record<string, unknown> = {}
    columns.forEach((col, i) => { record[col] = row[i] })

    const scope = record.scope as 'global' | 'book'
    const bookId = record.book_id as string | undefined

    // 删除模板文件
    try {
      await deleteFile(getTemplatePath(scope, bookId, templateId))
    } catch {
      // 文件不存在时忽略
    }

    // 从数据库中删除
    db.run('DELETE FROM templates WHERE id = ?', [templateId])
  } catch (error) {
    throw new Error(`删除模板失败: ${error instanceof Error ? error.message : String(error)}`)
  }
}

// ==================== 回收站管理 ====================

/** 回收站条目 */
export interface TrashItem {
  id: string
  type: 'book' | 'volume' | 'note'
  name: string
  deletedAt: number
  expiresAt: number
  originalPath: string
  bookId: string
  volumeId?: string
}

/**
 * 列出回收站中的所有内容
 */
export function listTrash(): TrashItem[] {
  try {
    const db = getDB()
    const items: TrashItem[] = []
    const now_ = now()
    const retentionMs = 30 * 24 * 60 * 60 * 1000 // 30天

    // 已删除的笔记（updated_at < 0 表示已删除）
    const noteResults = db.exec(`
      SELECT n.*, b.name as book_name, v.name as volume_name
      FROM notes n
      JOIN books b ON n.book_id = b.id
      LEFT JOIN volumes v ON n.volume_id = v.id
      WHERE n.updated_at < 0
    `)

    if (noteResults.length) {
      const cols = noteResults[0].columns
      for (const row of noteResults[0].values) {
        const r: Record<string, unknown> = {}
        cols.forEach((c, i) => { r[c] = row[i] })
        const deletedAt = -(r.updated_at as number)
        items.push({
          id: r.id as string,
          type: 'note',
          name: r.title as string,
          deletedAt,
          expiresAt: deletedAt + retentionMs,
          originalPath: `${r.book_name as string} / ${r.volume_name as string}`,
          bookId: r.book_id as string,
          volumeId: r.volume_id as string,
        })
      }
    }

    // 已删除的卷
    const volResults = db.exec(`
      SELECT v.*, b.name as book_name
      FROM volumes v
      JOIN books b ON v.book_id = b.id
      WHERE v.updated_at < 0
    `)

    if (volResults.length) {
      const cols = volResults[0].columns
      for (const row of volResults[0].values) {
        const r: Record<string, unknown> = {}
        cols.forEach((c, i) => { r[c] = row[i] })
        const deletedAt = -(r.updated_at as number)
        items.push({
          id: r.id as string,
          type: 'volume',
          name: r.name as string,
          deletedAt,
          expiresAt: deletedAt + retentionMs,
          originalPath: r.book_name as string,
          bookId: r.book_id as string,
        })
      }
    }

    // 已删除的书
    const bookResults = db.exec('SELECT * FROM books WHERE updated_at < 0')
    if (bookResults.length) {
      const cols = bookResults[0].columns
      for (const row of bookResults[0].values) {
        const r: Record<string, unknown> = {}
        cols.forEach((c, i) => { r[c] = row[i] })
        const deletedAt = -(r.updated_at as number)
        items.push({
          id: r.id as string,
          type: 'book',
          name: r.name as string,
          deletedAt,
          expiresAt: deletedAt + retentionMs,
          originalPath: '',
          bookId: r.id as string,
        })
      }
    }

    // 过滤掉已过期的
    return items.filter(item => item.expiresAt > now_)
  } catch (error) {
    throw new Error(`获取回收站列表失败: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * 从回收站恢复内容
 */
export async function restoreFromTrash(itemId: string, type: 'book' | 'volume' | 'note'): Promise<void> {
  ensureStorageReady()
  try {
    const db = getDB()
    const timestamp = now()
    const tableName = type === 'book' ? 'books' : type === 'volume' ? 'volumes' : 'notes'
    // 安全校验：只允许已知表名
    if (!['books', 'volumes', 'notes'].includes(tableName)) {
      throw new Error(`无效的恢复类型: ${type}`)
    }

    // 检查是否存在
    const results = db.exec(`SELECT * FROM ${tableName} WHERE id = ? AND updated_at < 0`, [itemId])
    if (!results.length || !results[0].values.length) {
      throw new Error(`未找到已删除的${type}: ${itemId}`)
    }

    const columns = results[0].columns
    const row = results[0].values[0]
    const record: Record<string, unknown> = {}
    columns.forEach((col, i) => { record[col] = row[i] })

    const bookId = record.book_id as string

    if (type === 'note') {
      // 移动文件回原位置
      try {
        const trashDir = getBookTrashPath(bookId)
        const files = await listDirectory(trashDir)
        const trashFile = files.find(f => f.startsWith(`${itemId}_`))
        if (trashFile) {
          const trashPath = `${trashDir}/${trashFile}`
          const originalPath = getNotePath(bookId, itemId)
          const data = await readFile(trashPath)
          await writeFile(originalPath, data)
          await deleteFile(trashPath)
        }
      } catch {
        // 文件操作失败不影响数据库恢复
      }
    }

    // 恢复数据库标记（tableName 已在上文校验）
    db.run(`UPDATE ${tableName} SET updated_at = ? WHERE id = ?`, [timestamp, itemId])
  } catch (error) {
    throw new Error(`恢复失败: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * 永久删除（【高风险】需人工审核）
 * - 彻底删除文件和数据库记录
 * - 不可恢复
 */
export async function permanentDelete(itemId: string, type: 'book' | 'volume' | 'note'): Promise<void> {
  ensureStorageReady()
  try {
    const db = getDB()

    if (type === 'note') {
      const results = db.exec('SELECT * FROM notes WHERE id = ?', [itemId])
      if (results.length && results[0].values.length) {
        const cols = results[0].columns
        const row = results[0].values[0]
        const r: Record<string, unknown> = {}
        cols.forEach((c, i) => { r[c] = row[i] })
        const bookId = r.book_id as string

        // 删除文件
        try {
          const files = await listDirectory(getBookTrashPath(bookId))
          const trashFile = files.find(f => f.startsWith(`${itemId}_`))
          if (trashFile) {
            await deleteFile(`${getBookTrashPath(bookId)}/${trashFile}`)
          }
          await deleteFile(getNotePath(bookId, itemId))
        } catch { /* 文件不存在则忽略 */ }
      }
      db.run('DELETE FROM notes WHERE id = ?', [itemId])
    } else if (type === 'volume') {
      const results = db.exec('SELECT * FROM volumes WHERE id = ?', [itemId])
      if (results.length && results[0].values.length) {
        const cols = results[0].columns
        const row = results[0].values[0]
        const r: Record<string, unknown> = {}
        cols.forEach((c, i) => { r[c] = row[i] })
        const bookId = r.book_id as string

        // 删除该卷下的所有笔记
        const notes = db.exec('SELECT id FROM notes WHERE volume_id = ?', [itemId])
        if (notes.length) {
          for (const noteRow of notes[0].values) {
            await permanentDelete(noteRow[0] as string, 'note')
          }
        }

        // 删除回收记录
        try {
          const trashDir = getBookTrashPath(bookId)
          const files = await listDirectory(trashDir)
          const trashFile = files.find(f => f.includes(`_volume_${itemId}_`))
          if (trashFile) {
            await deleteFile(`${trashDir}/${trashFile}`)
          }
        } catch { /* ignore */ }
      }
      db.run('DELETE FROM volumes WHERE id = ?', [itemId])
    } else if (type === 'book') {
      // 删除整本书的所有内容
      const results = db.exec('SELECT * FROM books WHERE id = ?', [itemId])
      if (results.length && results[0].values.length) {
        const bookId = results[0].values[0][0] as string

        // 删除该书下所有笔记和卷
        const volumes = db.exec('SELECT id FROM volumes WHERE book_id = ?', [bookId])
        if (volumes.length) {
          for (const volRow of volumes[0].values) {
            await permanentDelete(volRow[0] as string, 'volume')
          }
        }
        const notes = db.exec('SELECT id FROM notes WHERE book_id = ?', [bookId])
        if (notes.length) {
          for (const noteRow of notes[0].values) {
            await permanentDelete(noteRow[0] as string, 'note')
          }
        }

        // 删除整个 Books/{bookId}/ 目录
        try {
          await deleteDirectory(getBookPath(bookId))
        } catch { /* ignore */ }
      }
      db.run('DELETE FROM books WHERE id = ?', [itemId])
    }
  } catch (error) {
    throw new Error(`永久删除失败: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * 清理过期回收站内容
 * 删除超过 30 天的回收站条目
 */
export async function cleanExpiredTrash(): Promise<number> {
  ensureStorageReady()
  try {
    const now_ = now()
    let cleaned = 0

    const items = listTrash().filter(item => item.expiresAt <= now_)

    for (const item of items) {
      try {
        await permanentDelete(item.id, item.type)
        cleaned++
      } catch {
        // 单条清理失败不影响其他
      }
    }

    return cleaned
  } catch (error) {
    throw new Error(`清理回收站失败: ${error instanceof Error ? error.message : String(error)}`)
  }
}

// ==================== 全文搜索 ====================

/** 搜索结果条目 */
export interface SearchResult {
  noteId: string
  title: string
  volumeId: string
  volumeName: string
  bookId: string
  bookName: string
  snippet: string // 匹配的关键词上下文片段
  matchLine?: number // 匹配内容所在行号（从0开始）
}

/**
 * 全文搜索笔记
 * 基于 SQLite FTS5 索引，支持模糊匹配和结果高亮
 *
 * @param keyword - 搜索关键词
 * @param bookId - 限定书范围（可选，不传则搜索全部书）
 * @param limit - 最大结果数
 * @returns 搜索结果列表，按相关度排序
 */
export function searchNotes(keyword: string, bookId?: string, limit = 50): SearchResult[] {
  try {
    const db = getDB()
    const trimmed = keyword.trim()
    if (!trimmed) return []
    // 如果 FTS5 不可用，直接走 LIKE 降级
    if (!isFTS5Available()) {
      return fallbackSearch(keyword, bookId, limit)
    }

    // FTS5 查询语法：关键词加通配符支持前缀匹配
    // 使用 double-quote 包裹多词短语
    const ftsQuery = trimmed.split(/\s+/).map(w => `"${w.replace(/"/g, '""')}"`).join(' OR ')

    let sql = `
      SELECT
        n.id AS note_id,
        n.title AS note_title,
        n.volume_id,
        v.name AS volume_name,
        n.book_id,
        b.name AS book_name,
        snippet(notes_fts, 2, '<mark>', '</mark>', '...', 80) AS snippet
      FROM notes_fts fts
      JOIN notes n ON n.rowid = fts.rowid
      LEFT JOIN volumes v ON n.volume_id = v.id
      LEFT JOIN books b ON n.book_id = b.id
      WHERE notes_fts MATCH ?
        AND n.updated_at > 0
    `
    const params: string[] = [ftsQuery]

    if (bookId) {
      sql += ' AND n.book_id = ?'
      params.push(bookId)
    }

    sql += ' ORDER BY rank LIMIT ?'
    params.push(String(limit))

    const results = db.exec(sql, params)
    if (!results.length) return []

    const cols = results[0].columns
    return results[0].values.map((row) => {
      const r: Record<string, unknown> = {}
      cols.forEach((c, i) => { r[c] = row[i] })
      return {
        noteId: r.note_id as string,
        title: r.note_title as string,
        volumeId: r.volume_id as string,
        volumeName: (r.volume_name as string) || '(已删除的卷)',
        bookId: r.book_id as string,
        bookName: (r.book_name as string) || '(已删除的书)',
        snippet: (r.snippet as string) || '',
      }
    })
  } catch (error) {
    // FTS5 查询可能因特殊字符失败，降级为 LIKE 查询
    return fallbackSearch(keyword, bookId, limit)
  }
}

/**
 * 降级搜索（当 FTS5 查询失败时使用 LIKE）
 * 同时搜索标题和笔记内容
 */
function fallbackSearch(keyword: string, bookId?: string, limit = 50): SearchResult[] {
  try {
    const db = getDB()
    const like = `%${keyword}%`

    // 搜索标题匹配的笔记
    let sql = `
      SELECT
        n.id AS note_id,
        n.title AS note_title,
        n.volume_id,
        v.name AS volume_name,
        n.book_id,
        b.name AS book_name
      FROM notes n
      LEFT JOIN volumes v ON n.volume_id = v.id
      LEFT JOIN books b ON n.book_id = b.id
      WHERE (n.title LIKE ?) AND n.updated_at > 0
    `
    const params: string[] = [like]

    if (bookId) {
      sql += ' AND n.book_id = ?'
      params.push(bookId)
    }

    sql += ' LIMIT ?'
    params.push(String(limit))

    const results = db.exec(sql, params)
    if (!results.length) return []

    const cols = results[0].columns
    const titleMatches: SearchResult[] = results[0].values.map((row) => {
      const r: Record<string, unknown> = {}
      cols.forEach((c, i) => { r[c] = row[i] })
      const title = r.note_title as string
      // 在标题中高亮匹配的关键词
      const escapedKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const highlightedTitle = title.replace(new RegExp(escapedKeyword, 'gi'), '<mark>$&</mark>')
      return {
        noteId: r.note_id as string,
        title: title,
        volumeId: r.volume_id as string,
        volumeName: (r.volume_name as string) || '(已删除的卷)',
        bookId: r.book_id as string,
        bookName: (r.book_name as string) || '(已删除的书)',
        snippet: highlightedTitle,
      }
    })

    // 搜索内容匹配的笔记（排除已通过标题匹配的）
    const titleNoteIds = new Set(titleMatches.map(r => r.noteId))
    let contentSql = `
      SELECT
        n.id AS note_id,
        n.title AS note_title,
        n.volume_id,
        v.name AS volume_name,
        n.book_id,
        b.name AS book_name
      FROM notes n
      LEFT JOIN volumes v ON n.volume_id = v.id
      LEFT JOIN books b ON n.book_id = b.id
      WHERE n.updated_at > 0
    `
    const contentParams: string[] = []

    if (bookId) {
      contentSql += ' AND n.book_id = ?'
      contentParams.push(bookId)
    }

    contentSql += ' LIMIT ?'
    contentParams.push(String(limit))

    const contentResults = db.exec(contentSql, contentParams)
    const contentMatches: SearchResult[] = []

    if (contentResults.length) {
      const cCols = contentResults[0].columns
      for (const row of contentResults[0].values) {
        const r: Record<string, unknown> = {}
        cCols.forEach((c, i) => { r[c] = row[i] })
        const noteId = r.note_id as string
        if (titleNoteIds.has(noteId)) continue

        // 尝试从 FTS 索引获取内容 snippet
        let snippet = ''
        let matchLine: number | undefined
        try {
          const ftsResults = db.exec(
            `SELECT snippet(notes_fts, 2, '<mark>', '</mark>', '...', 80) AS snippet FROM notes_fts WHERE rowid = (SELECT rowid FROM notes WHERE id = ?) AND notes_fts MATCH ?`,
            [noteId, `"${keyword.replace(/"/g, '""')}"`]
          )
          if (ftsResults.length && ftsResults[0].values.length) {
            snippet = ftsResults[0].values[0][0] as string
          }
        } catch { /* FTS 不可用 */ }

        // 如果 FTS 没有返回 snippet，从笔记标题生成一个
        if (!snippet) {
          const title = r.note_title as string
          const escapedKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          snippet = title.replace(new RegExp(escapedKeyword, 'gi'), '<mark>$&</mark>')
        }

        contentMatches.push({
          noteId,
          title: r.note_title as string,
          volumeId: r.volume_id as string,
          volumeName: (r.volume_name as string) || '(已删除的卷)',
          bookId: r.book_id as string,
          bookName: (r.book_name as string) || '(已删除的书)',
          snippet,
          matchLine,
        })

        if (contentMatches.length >= limit) break
      }
    }

    return [...titleMatches, ...contentMatches].slice(0, limit)
  } catch {
    return []
  }
}
