/**
 * SQLite 数据库初始化与管理
 *
 * 定位：仅作为索引缓存，损坏时可以从 .note 文件完全重建
 * 数据库文件：Books/.index.db，与用户数据同目录
 *
 * 表结构：
 * - books / volumes / notes：三级内容元数据
 * - notes_fts：FTS5 全文索引（部分 sql.js 构建不支持，会自动降级为 LIKE 搜索）
 * - images：图片索引
 * - templates：模板元数据
 * - search_history：搜索历史
 */

import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js'
import { DB_FILE_PATH } from '@/config'

/** 单例 SQL.js 实例 */
let SQL: SqlJsStatic | null = null

/** 当前数据库实例 */
let db: Database | null = null

/** 当前 sql.js 构建是否支持 FTS5（初始化时自动检测） */
let fts5Available = false

/**
 * 初始化 SQL.js Wasm 模块
 * 只需调用一次
 */
async function initSQL(): Promise<SqlJsStatic> {
  if (!SQL) {
    try {
      SQL = await initSqlJs({
        // 指定 WASM 文件路径（需复制到 public/ 目录）
        locateFile: (_file: string) => '/sql-wasm.wasm',
      })
    } catch (err) {
      throw new Error(`SQLite WASM 加载失败: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  return SQL
}

/**
 * 基础建表语句（不含 FTS5，所有 sql.js 构建均支持）
 */
const BASE_SCHEMA_SQL = `
-- 书表
CREATE TABLE IF NOT EXISTS books (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 卷表
CREATE TABLE IF NOT EXISTS volumes (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
);

-- 笔记表
CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  volume_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  title TEXT NOT NULL,
  content_hash TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  word_count INTEGER NOT NULL DEFAULT 0,
  image_count INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (volume_id) REFERENCES volumes(id) ON DELETE CASCADE,
  FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
);

-- 图片索引表
CREATE TABLE IF NOT EXISTS images (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  note_id TEXT,
  local_path TEXT NOT NULL,
  synced INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  size INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE,
  FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE SET NULL
);

-- 模板元数据表
CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'global',
  book_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
);

-- 搜索历史表
CREATE TABLE IF NOT EXISTS search_history (
  id TEXT PRIMARY KEY,
  keyword TEXT NOT NULL,
  timestamp INTEGER NOT NULL
);

-- 性能索引
CREATE INDEX IF NOT EXISTS idx_volumes_book_id ON volumes(book_id);
CREATE INDEX IF NOT EXISTS idx_notes_volume_id ON notes(volume_id);
CREATE INDEX IF NOT EXISTS idx_notes_book_id ON notes(book_id);
CREATE INDEX IF NOT EXISTS idx_notes_updated_at ON notes(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_images_book_id ON images(book_id);
CREATE INDEX IF NOT EXISTS idx_images_note_id ON images(note_id);
`

/**
 * FTS5 建表语句（仅当 sql.js 编译了 FTS5 扩展时可用）
 */
const FTS5_SCHEMA_SQL = `
-- FTS5 全文搜索索引
CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
  title,
  content,
  content='notes',
  content_rowid='rowid'
);

-- FTS5 同步触发器：插入
CREATE TRIGGER IF NOT EXISTS notes_ai AFTER INSERT ON notes BEGIN
  INSERT INTO notes_fts(rowid, title, content)
  VALUES (new.rowid, new.title, '');
END;

-- FTS5 同步触发器：删除
CREATE TRIGGER IF NOT EXISTS notes_ad AFTER DELETE ON notes BEGIN
  INSERT INTO notes_fts(notes_fts, rowid, title, content)
  VALUES ('delete', old.rowid, old.title, '');
END;

-- FTS5 同步触发器：更新
CREATE TRIGGER IF NOT EXISTS notes_au AFTER UPDATE ON notes BEGIN
  INSERT INTO notes_fts(notes_fts, rowid, title, content)
  VALUES ('delete', old.rowid, old.title, '');
  INSERT INTO notes_fts(rowid, title, content)
  VALUES (new.rowid, new.title, '');
END;
`

/**
 * 创建或打开数据库
 * @param loadFile - 从文件系统加载数据库的函数
 * @param saveFile - 保存数据库到文件系统的函数
 */
export async function initDatabase(
  loadFile: (path: string) => Promise<Uint8Array | null>,
  saveFile: (path: string, data: Uint8Array) => Promise<void>
): Promise<Database> {
  const sql = await initSQL()

  // 尝试从文件加载已有数据库
  let existingData: Uint8Array | null = null
  try {
    existingData = await loadFile(DB_FILE_PATH)
  } catch {
    // 数据库文件不存在，将创建新库
  }

  if (existingData && existingData.length > 0) {
    db = new sql.Database(existingData)
  } else {
    db = new sql.Database()
  }

  // 执行基础建表语句（所有 sql.js 构建均支持）
  db.run(BASE_SCHEMA_SQL)

  // 尝试启用 FTS5 全文搜索（部分 sql.js 构建不支持）
  try {
    db.run(FTS5_SCHEMA_SQL)
    fts5Available = true
    console.log('[DB] FTS5 全文搜索已启用')
  } catch {
    fts5Available = false
    console.warn('[DB] FTS5 不可用，搜索将降级为 LIKE 匹配')
  }

  // 保存数据库到文件
  await saveDB(saveFile)

  return db
}

/**
 * 获取当前数据库实例
 * 未初始化时抛出错误
 */
export function getDB(): Database {
  if (!db) {
    throw new Error('数据库未初始化，请先调用 initDatabase()')
  }
  return db
}

/**
 * 检查 FTS5 是否可用
 */
export function isFTS5Available(): boolean {
  return fts5Available
}

/**
 * 保存数据库到文件系统
 */
export async function saveDB(
  saveFile: (path: string, data: Uint8Array) => Promise<void>
): Promise<void> {
  try {
    const database = getDB()
    const data = database.export()
    await saveFile(DB_FILE_PATH, data)
  } catch (err) {
    throw new Error(`数据库保存失败: ${err instanceof Error ? err.message : String(err)}`)
  }
}

/**
 * 关闭数据库连接
 */
export function closeDB(): void {
  if (db) {
    db.close()
    db = null
  }
}

/**
 * 更新笔记的 FTS5 全文索引内容
 * 在笔记保存时调用，将解密后的明文内容写入 FTS 索引
 * 如果 FTS5 不可用，此函数为空操作
 */
export function updateFTSContent(noteRowId: number, plainContent: string): void {
  if (!fts5Available) return

  const database = getDB()
  try {
    database.run(`DELETE FROM notes_fts WHERE rowid = ?`, [noteRowId])
    database.run(
      `INSERT INTO notes_fts(rowid, title, content) SELECT rowid, title, ? FROM notes WHERE rowid = ?`,
      [plainContent, noteRowId]
    )
  } catch {
    // FTS5 表可能在后来的数据库加载中不存在
    fts5Available = false
  }
}

/**
 * 从文件系统重建数据库（当 .index.db 损坏时）
 * 扫描所有 .note 文件，解密后重建索引
 */
export async function rebuildDatabase(
  _listFiles: (dirPath: string) => Promise<string[]>,
  _readFile: (filePath: string) => Promise<Uint8Array>,
  _decryptFn: (data: Uint8Array) => Promise<Uint8Array>
): Promise<void> {
  // TODO: 阶段二实现
  // 1. 扫描所有 Books/ 下的 .note 文件
  // 2. 逐个解密提取元数据
  // 3. 重建 books/volumes/notes/images 表
  // 4. 如果 FTS5 可用，重建 FTS5 索引
  throw new Error('数据库重建功能尚未实现')
}
