import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// 使用 vi.hoisted 声明 mock 工厂中需要引用的变量
const { getMockDbRef, setMockDbRef } = vi.hoisted(() => {
  let mockDb: any = null
  return {
    getMockDbRef: () => mockDb,
    setMockDbRef: (db: any) => { mockDb = db },
  }
})

// Mock sql.js
vi.mock('sql.js', () => {
  const mockDb = {
    run: vi.fn(),
    exec: vi.fn().mockReturnValue([]),
    getRowsModified: vi.fn().mockReturnValue(1),
    export: vi.fn().mockReturnValue(new Uint8Array([1, 2, 3])),
    close: vi.fn(),
  }
  setMockDbRef(mockDb)
  const mockInitSqlJs = vi.fn().mockResolvedValue({
    Database: vi.fn().mockImplementation(() => mockDb),
  })
  return {
    __esModule: true,
    default: mockInitSqlJs,
    initSqlJs: mockInitSqlJs,
  }
})

// Mock config
vi.mock('@/config', () => ({
  DB_FILE_PATH: 'data/localnotes.db',
  BASE_SCHEMA_SQL: `
    CREATE TABLE IF NOT EXISTS books (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      note_count INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS trash (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      parent_id TEXT,
      deleted_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
  `,
}))

import {
  initDatabase, getDB, saveDB, closeDB,
  isFTS5Available, updateFTSContent,
} from '@/engine/database'

// 获取 mock 引用
function getMockDb() {
  return getMockDbRef()!
}

describe('database', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    closeDB()
  })

  // ==================== initDatabase ====================
  describe('initDatabase', () => {
    it('无已有数据库时应创建新数据库并执行 schema', async () => {
      const mockReadFile = vi.fn().mockResolvedValue(null)
      const mockWriteFile = vi.fn().mockResolvedValue(undefined)

      await initDatabase(mockReadFile, mockWriteFile)

      // 应尝试读取数据库文件
      expect(mockReadFile).toHaveBeenCalledWith('data/localnotes.db')

      // 应创建新 Database（readFile 返回 null）
      const mockDb = getMockDb()
      expect(mockDb.exec).toHaveBeenCalledWith(
        expect.stringContaining('CREATE TABLE'),
      )

      // 应导出并保存新数据库
      expect(mockDb.export).toHaveBeenCalled()
      expect(mockWriteFile).toHaveBeenCalledWith('data/localnotes.db', expect.any(Uint8Array))
    })

    it('已有数据库时应打开已有数据', async () => {
      const existingData = new Uint8Array([10, 20, 30])
      const mockReadFile = vi.fn().mockResolvedValue(existingData)
      const mockWriteFile = vi.fn().mockResolvedValue(undefined)

      await initDatabase(mockReadFile, mockWriteFile)

      const mockDb = getMockDb()
      expect(mockDb.run).not.toHaveBeenCalledWith(
        expect.stringContaining('CREATE TABLE'),
      )
    })

    it('readFile 抛出异常时应创建新数据库', async () => {
      const mockReadFile = vi.fn().mockRejectedValue(new Error('读取失败'))
      const mockWriteFile = vi.fn().mockResolvedValue(undefined)

      // readFile 异常会被 catch 捕获并重新抛出
      await expect(initDatabase(mockReadFile, mockWriteFile)).rejects.toThrow('数据库初始化失败')
    })
  })

  // ==================== getDB ====================
  describe('getDB', () => {
    it('未初始化时应抛出错误', () => {
      closeDB()
      expect(() => getDB()).toThrow('数据库未初始化')
    })

    it('初始化后应返回数据库实例', async () => {
      const mockReadFile = vi.fn().mockResolvedValue(null)
      const mockWriteFile = vi.fn().mockResolvedValue(undefined)

      await initDatabase(mockReadFile, mockWriteFile)

      const db = getDB()
      expect(db).toBeDefined()
    })
  })

  // ==================== saveDB ====================
  describe('saveDB', () => {
    it('应导出数据库并写入文件', async () => {
      const mockReadFile = vi.fn().mockResolvedValue(null)
      const mockWriteFile = vi.fn().mockResolvedValue(undefined)

      await initDatabase(mockReadFile, mockWriteFile)
      await saveDB()

      const mockDb = getMockDb()
      expect(mockDb.export).toHaveBeenCalled()
      expect(mockWriteFile).toHaveBeenCalledWith('data/localnotes.db', expect.any(Uint8Array))
    })

    it('未初始化时应抛出错误', async () => {
      closeDB()
      await expect(saveDB()).rejects.toThrow()
    })
  })

  // ==================== closeDB ====================
  describe('closeDB', () => {
    it('应关闭数据库并清空缓存', async () => {
      const mockReadFile = vi.fn().mockResolvedValue(null)
      const mockWriteFile = vi.fn().mockResolvedValue(undefined)

      await initDatabase(mockReadFile, mockWriteFile)
      closeDB()

      const mockDb = getMockDb()
      expect(mockDb.close).toHaveBeenCalled()
      expect(() => getDB()).toThrow('数据库未初始化')
    })
  })

  // ==================== isFTS5Available ====================
  describe('isFTS5Available', () => {
    it('FTS5 表存在时应返回 true', async () => {
      const mockReadFile = vi.fn().mockResolvedValue(null)
      const mockWriteFile = vi.fn().mockResolvedValue(undefined)

      const mockDb = getMockDb()
      mockDb.exec.mockImplementation((sql: string) => {
        // BASE_SCHEMA_SQL 的 exec 不返回结果
        if (sql.includes('CREATE TABLE IF NOT EXISTS books')) return []
        // FTS5 schema 的 exec 不返回结果
        if (sql.includes('CREATE VIRTUAL TABLE')) return []
        // sqlite_master 查询返回 notes_fts
        if (sql.includes('sqlite_master')) {
          return [[{ columns: ['name'], values: [['notes_fts']] }]]
        }
        return []
      })

      await initDatabase(mockReadFile, mockWriteFile)
      expect(isFTS5Available()).toBe(true)
    })

    it('FTS5 表不存在时应返回 false', async () => {
      const mockReadFile = vi.fn().mockResolvedValue(null)
      const mockWriteFile = vi.fn().mockResolvedValue(undefined)

      const mockDb = getMockDb()
      mockDb.exec.mockImplementation((sql: string) => {
        if (sql.includes('CREATE TABLE')) return []
        if (sql.includes('CREATE VIRTUAL TABLE')) {
          // 模拟 FTS5 不支持
          throw new Error('FTS5 not available')
        }
        if (sql.includes('sqlite_master')) {
          return [[{ columns: ['name'], values: [['books']] }]]
        }
        return []
      })

      await initDatabase(mockReadFile, mockWriteFile)
      expect(isFTS5Available()).toBe(false)
    })
  })

  // ==================== updateFTSContent ====================
  describe('updateFTSContent', () => {
    it('FTS5 不可用时应静默跳过', async () => {
      const mockReadFile = vi.fn().mockResolvedValue(null)
      const mockWriteFile = vi.fn().mockResolvedValue(undefined)

      const mockDb = getMockDb()
      mockDb.exec.mockImplementation((sql: string) => {
        if (sql.includes('sqlite_master')) {
          return [[{ columns: ['name'], values: [['books']] }]]
        }
        return []
      })

      await initDatabase(mockReadFile, mockWriteFile)
      expect(() => updateFTSContent('note-1', '标题', '内容')).not.toThrow()
    })

    it('FTS5 可用时应更新索引', async () => {
      const mockReadFile = vi.fn().mockResolvedValue(null)
      const mockWriteFile = vi.fn().mockResolvedValue(undefined)

      const mockDb = getMockDb()
      mockDb.exec.mockImplementation((sql: string) => {
        if (sql.includes('sqlite_master')) {
          return [[{ columns: ['name'], values: [['notes_fts']] }]]
        }
        return []
      })

      await initDatabase(mockReadFile, mockWriteFile)
      updateFTSContent('note-1', '标题', '内容')

      expect(mockDb.run).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM notes_fts'),
        expect.anything(),
      )
      expect(mockDb.run).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO notes_fts'),
        expect.anything(),
      )
    })
  })
})
