import { describe, it, expect, vi, beforeEach } from 'vitest'

// ==================== Mock storage module ====================
vi.mock('@/engine/storage', () => ({
  initStorage: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  fileExists: vi.fn(),
  deleteFile: vi.fn(),
  listDirectory: vi.fn(),
  createDirectory: vi.fn(),
  moveFile: vi.fn(),
  deleteDirectory: vi.fn(),
  isStorageReady: vi.fn(() => true),
}))

// ==================== Mock database module ====================
vi.mock('@/engine/database', () => ({
  initDatabase: vi.fn(),
  getDB: vi.fn(),
  isFTS5Available: vi.fn(() => false),
  saveDB: vi.fn(),
  closeDB: vi.fn(),
  updateFTSContent: vi.fn(),
}))

// ==================== Mock encryption module ====================
vi.mock('@/engine/encryption', () => ({
  encryptString: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
  decryptToString: vi.fn().mockResolvedValue('decrypted-content'),
  sha256: vi.fn().mockResolvedValue('abc123hash'),
  getKey: vi.fn().mockResolvedValue({}),
  exportRawKey: vi.fn().mockResolvedValue(new Uint8Array(32)),
}))

// ==================== Imports (after mocks) ====================
import {
  listBooks, getBook, createBook, renameBook,
  listVolumes, createVolume,
  listNotes, createNote, getNote, renameNote,
  searchNotes,
  listTrash, restoreFromTrash, permanentDelete, cleanExpiredTrash,
  listTemplates, createTemplate, deleteTemplate,
} from '@/engine/note-engine'
import type { TrashItem } from '@/engine/note-engine'
import * as storage from '@/engine/storage'
import * as database from '@/engine/database'

// ==================== Helper: 创建 mock Database 对象 ====================
function createMockDB(execResults: unknown[][] = []) {
  return {
    run: vi.fn(),
    exec: vi.fn().mockImplementation((..._args: unknown[]) => {
      if (execResults.length > 0) {
        return execResults.shift() as unknown[]
      }
      return []
    }),
    getRowsModified: vi.fn().mockReturnValue(1),
    export: vi.fn().mockReturnValue(new Uint8Array([0])),
    close: vi.fn(),
  }
}

// ==================== Tests ====================
describe('note-engine', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(storage.isStorageReady).mockReturnValue(true)
    vi.mocked(database.isFTS5Available).mockReturnValue(false)
  })

  // ==================== listBooks ====================
  describe('listBooks', () => {
    it('存储未就绪时应抛出错误', () => {
      vi.mocked(storage.isStorageReady).mockReturnValue(false)
      expect(() => listBooks()).toThrow('存储未初始化')
    })

    it('数据库无结果时应返回空数组', () => {
      const mockDb = createMockDB([[]])
      vi.mocked(database.getDB).mockReturnValue(mockDb as never)

      const result = listBooks()
      expect(result).toEqual([])
    })

    it('应正确解析数据库结果并返回 Book 数组', () => {
      const mockDb = createMockDB([
        [
          {
            columns: ['id', 'name', 'created_at', 'updated_at', 'note_count'],
            values: [
              ['book-1', '我的第一本书', 1000, 2000, 5],
              ['book-2', '学习笔记', 3000, 4000, 10],
            ],
          },
        ],
      ])
      vi.mocked(database.getDB).mockReturnValue(mockDb as never)

      const result = listBooks()

      expect(result).toHaveLength(2)
      expect(result[0]).toEqual({
        id: 'book-1',
        name: '我的第一本书',
        createdAt: 1000,
        updatedAt: 2000,
        noteCount: 5,
      })
    })

    it('支持按创建时间排序', () => {
      const mockDb = createMockDB([
        [
          {
            columns: ['id', 'name', 'created_at', 'updated_at', 'note_count'],
            values: [['book-1', '书', 1000, 2000, 0]],
          },
        ],
      ])
      vi.mocked(database.getDB).mockReturnValue(mockDb as never)

      const result = listBooks('createdAt')
      expect(result).toHaveLength(1)
      // 验证 SQL 中使用了 created_at 排序
      const sql = mockDb.exec.mock.calls[0][0] as string
      expect(sql).toContain('created_at DESC')
    })
  })

  // ==================== getBook ====================
  describe('getBook', () => {
    it('书不存在时应返回 null', () => {
      const mockDb = createMockDB([[]])
      vi.mocked(database.getDB).mockReturnValue(mockDb as never)

      const result = getBook('non-existent-id')
      expect(result).toBeNull()
    })

    it('书存在时应返回正确的 Book 对象', () => {
      const mockDb = createMockDB([
        [
          {
            columns: ['id', 'name', 'created_at', 'updated_at', 'note_count'],
            values: [['book-abc', '测试书籍', 1000, 2000, 3]],
          },
        ],
      ])
      vi.mocked(database.getDB).mockReturnValue(mockDb as never)

      const result = getBook('book-abc')

      expect(result).not.toBeNull()
      expect(result!.id).toBe('book-abc')
      expect(result!.name).toBe('测试书籍')
      expect(result!.noteCount).toBe(3)
    })
  })

  // ==================== createBook ====================
  describe('createBook', () => {
    it('应正确创建书并返回 Book 对象', () => {
      const mockDb = createMockDB()
      vi.mocked(database.getDB).mockReturnValue(mockDb as never)

      const result = createBook('新书')

      expect(result.name).toBe('新书')
      expect(result.id).toBeDefined()
      expect(result.createdAt).toBeGreaterThan(0)
      expect(mockDb.run).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO books'),
        expect.arrayContaining([expect.any(String), '新书', expect.any(Number), expect.any(Number), 0]),
      )
    })
  })

  // ==================== renameBook ====================
  describe('renameBook', () => {
    it('应执行 UPDATE SQL', () => {
      const mockDb = createMockDB()
      vi.mocked(database.getDB).mockReturnValue(mockDb as never)

      renameBook('book-1', '新名字')

      expect(mockDb.run).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE books SET name'),
        expect.arrayContaining(['新名字', expect.any(Number), 'book-1']),
      )
    })
  })

  // ==================== listVolumes ====================
  describe('listVolumes', () => {
    it('应正确返回卷列表', () => {
      const mockDb = createMockDB([
        [
          {
            columns: ['id', 'book_id', 'name', 'created_at', 'updated_at', 'note_count', 'sort_order'],
            values: [['vol-1', 'book-1', '默认卷', 1000, 2000, 5, 0]],
          },
        ],
      ])
      vi.mocked(database.getDB).mockReturnValue(mockDb as never)

      const result = listVolumes('book-1')

      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('vol-1')
      expect(result[0].bookId).toBe('book-1')
      expect(result[0].sortOrder).toBe(0)
    })
  })

  // ==================== createVolume ====================
  describe('createVolume', () => {
    it('存储未就绪时应抛出错误', () => {
      vi.mocked(storage.isStorageReady).mockReturnValue(false)
      expect(() => createVolume('book-1', '新卷')).toThrow('存储未初始化')
    })
  })

  // ==================== listNotes ====================
  describe('listNotes', () => {
    it('应正确返回笔记列表', () => {
      const mockDb = createMockDB([
        [
          {
            columns: ['id', 'volume_id', 'book_id', 'title', 'content_hash', 'created_at', 'updated_at', 'word_count', 'image_count'],
            values: [['note-1', 'vol-1', 'book-1', '测试笔记', 'hash123', 1000, 2000, 100, 2]],
          },
        ],
      ])
      vi.mocked(database.getDB).mockReturnValue(mockDb as never)

      const result = listNotes('vol-1')

      expect(result).toHaveLength(1)
      expect(result[0].title).toBe('测试笔记')
      expect(result[0].wordCount).toBe(100)
      expect(result[0].imageCount).toBe(2)
    })
  })

  // ==================== getNote ====================
  describe('getNote', () => {
    it('笔记不存在时应返回 null', () => {
      const mockDb = createMockDB([[]])
      vi.mocked(database.getDB).mockReturnValue(mockDb as never)

      expect(getNote('non-existent')).toBeNull()
    })
  })

  // ==================== createNote ====================
  describe('createNote', () => {
    it('卷不存在时应抛出错误', () => {
      const mockDb = createMockDB([[]]) // getVolume 返回 null
      vi.mocked(database.getDB).mockReturnValue(mockDb as never)

      expect(() => createNote('vol-nonexist', '标题')).toThrow('卷不存在')
    })
  })

  // ==================== searchNotes ====================
  describe('searchNotes', () => {
    it('空关键词应返回空数组', () => {
      expect(searchNotes('   ')).toEqual([])
      expect(searchNotes('')).toEqual([])
    })

    it('FTS5 不可用时应使用 LIKE 搜索', () => {
      vi.mocked(database.isFTS5Available).mockReturnValue(false)

      const mockDb = createMockDB([
        [
          {
            columns: ['note_id', 'note_title', 'volume_id', 'volume_name', 'book_id', 'book_name'],
            values: [['note-1', '测试笔记标题', 'vol-1', '默认卷', 'book-1', '我的书']],
          },
        ],
      ])
      vi.mocked(database.getDB).mockReturnValue(mockDb as never)

      const result = searchNotes('测试')

      expect(result).toHaveLength(1)
      expect(result[0].noteId).toBe('note-1')
      // 验证使用了 LIKE 查询
      const sql = mockDb.exec.mock.calls[0][0] as string
      expect(sql).toContain('LIKE')
    })

    it('FTS5 可用时应使用 FTS 查询', () => {
      vi.mocked(database.isFTS5Available).mockReturnValue(true)

      const mockDb = createMockDB([
        [
          {
            columns: ['note_id', 'note_title', 'volume_id', 'volume_name', 'book_id', 'book_name', 'snippet'],
            values: [
              ['note-1', 'FTS测试', 'vol-1', '卷A', 'book-1', '我的书', 'FTS测试内容...'],
            ],
          },
        ],
      ])
      vi.mocked(database.getDB).mockReturnValue(mockDb as never)

      const result = searchNotes('FTS')

      expect(result).toHaveLength(1)
      expect(result[0].snippet).toBe('FTS测试内容...')
      expect(mockDb.exec).toHaveBeenCalledWith(
        expect.stringContaining('notes_fts MATCH ?'),
        expect.anything(),
      )
    })

    it('应正确应用 bookId 过滤', () => {
      vi.mocked(database.isFTS5Available).mockReturnValue(false)

      const mockDb = createMockDB([
        [
          {
            columns: ['note_id', 'note_title', 'volume_id', 'volume_name', 'book_id', 'book_name'],
            values: [],
          },
        ],
      ])
      vi.mocked(database.getDB).mockReturnValue(mockDb as never)

      searchNotes('过滤', 'book-target')

      const sql = mockDb.exec.mock.calls[0][0] as string
      const params = mockDb.exec.mock.calls[0][1] as unknown[]
      expect(sql).toContain('n.book_id = ?')
      expect(params).toContain('book-target')
    })

    it('应正确应用 limit 限制', () => {
      vi.mocked(database.isFTS5Available).mockReturnValue(false)

      const mockDb = createMockDB([
        [
          {
            columns: ['note_id', 'note_title', 'volume_id', 'volume_name', 'book_id', 'book_name'],
            values: Array.from({ length: 100 }, (_, i) => [
              `note-${i}`, `标题 ${i}`, 'vol-1', '卷A', 'book-1', '我的书',
            ]),
          },
        ],
      ])
      vi.mocked(database.getDB).mockReturnValue(mockDb as never)

      const result = searchNotes('标题', undefined, 10)
      // SQL 中有 LIMIT 10，但 mock 返回了全部数据
      // 验证 SQL 包含 LIMIT 子句
      const sql = mockDb.exec.mock.calls[0][0] as string
      expect(sql).toContain('LIMIT')
      const params = mockDb.exec.mock.calls[0][1] as unknown[]
      expect(params).toContain(10)
    })
  })

  // ==================== listTrash ====================
  describe('listTrash', () => {
    it('回收站为空时应返回空数组', () => {
      const mockDb = createMockDB([[]])
      vi.mocked(database.getDB).mockReturnValue(mockDb as never)

      expect(listTrash()).toEqual([])
    })

    it('应正确列出 trash 表中的条目', () => {
      const nowMs = Date.now()
      const retentionMs = 30 * 24 * 60 * 60 * 1000

      const mockDb = createMockDB([
        [
          {
            columns: ['id', 'type', 'name', 'parent_id', 'deleted_at', 'expires_at'],
            values: [
              ['note-del-1', 'note', '已删除笔记', 'vol-1', nowMs - 60000, nowMs - 60000 + retentionMs],
              ['vol-del-1', 'volume', '已删除卷', 'book-1', nowMs - 600000, nowMs - 600000 + retentionMs],
              ['book-del-1', 'book', '已删除书', null, nowMs - 3600000, nowMs - 3600000 + retentionMs],
            ],
          },
        ],
      ])
      vi.mocked(database.getDB).mockReturnValue(mockDb as never)

      const result = listTrash()

      expect(result).toHaveLength(3)

      const noteItem = result.find((i: TrashItem) => i.type === 'note')
      expect(noteItem!.id).toBe('note-del-1')
      expect(noteItem!.name).toBe('已删除笔记')
      expect(noteItem!.volumeId).toBe('vol-1')

      const volItem = result.find((i: TrashItem) => i.type === 'volume')
      expect(volItem!.id).toBe('vol-del-1')
      expect(volItem!.bookId).toBe('book-1')

      const bookItem = result.find((i: TrashItem) => i.type === 'book')
      expect(bookItem!.id).toBe('book-del-1')
      expect(bookItem!.bookId).toBeUndefined()
    })

    it('应过滤掉已过期的条目', () => {
      const mockDb = createMockDB([
        // 模拟 SQL 返回空结果（WHERE expires_at > now 已过滤）
        [],
      ])
      vi.mocked(database.getDB).mockReturnValue(mockDb as never)

      const result = listTrash()
      expect(result).toHaveLength(0)
      // 验证 SQL 包含 expires_at 过滤条件
      const sql = mockDb.exec.mock.calls[0][0] as string
      expect(sql).toContain('expires_at >')
    })
  })

  // ==================== restoreFromTrash ====================
  describe('restoreFromTrash', () => {
    it('条目不存在时应抛出错误', () => {
      const mockDb = createMockDB([[]])
      vi.mocked(database.getDB).mockReturnValue(mockDb as never)

      expect(() => restoreFromTrash('nonexist', 'note')).toThrow('回收站中不存在该项目')
    })

    it('应正确恢复笔记（从 trash 表读取 + 删除记录 + 重新插入 notes 表）', () => {
      const mockDb = createMockDB([
        // trash 查询
        [
          {
            columns: ['name', 'parent_id', 'deleted_at'],
            values: [['恢复笔记', 'vol-1', 1000000]],
          },
        ],
      ])
      vi.mocked(database.getDB).mockReturnValue(mockDb as never)

      restoreFromTrash('note-1', 'note')

      // 应从 trash 表删除
      expect(mockDb.run).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM trash'),
        expect.arrayContaining(['note-1']),
      )
      // 应重新插入 notes 表
      expect(mockDb.run).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO notes'),
        expect.arrayContaining(['note-1', '恢复笔记']),
      )
    })
  })

  // ==================== permanentDelete ====================
  describe('permanentDelete', () => {
    it('应从 trash 表删除记录', () => {
      const mockDb = createMockDB([
        [{ columns: ['deleted_at'], values: [[1000000]] }],
      ])
      vi.mocked(database.getDB).mockReturnValue(mockDb as never)

      permanentDelete('note-1', 'note')

      expect(mockDb.run).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM trash'),
        expect.arrayContaining(['note-1']),
      )
    })
  })

  // ==================== cleanExpiredTrash ====================
  describe('cleanExpiredTrash', () => {
    it('无过期条目时应返回 0', () => {
      const mockDb = createMockDB([[]])
      vi.mocked(database.getDB).mockReturnValue(mockDb as never)

      expect(cleanExpiredTrash()).toBe(0)
    })

    it('应删除过期条目并返回数量', () => {
      const mockDb = createMockDB([
        [{ columns: ['id', 'type', 'deleted_at'], values: [['n1', 'note', 1000], ['n2', 'note', 2000]] }],
      ])
      mockDb.getRowsModified = vi.fn().mockReturnValue(1)
      vi.mocked(database.getDB).mockReturnValue(mockDb as never)

      const count = cleanExpiredTrash()
      expect(count).toBe(2)
    })
  })

  // ==================== listTemplates ====================
  describe('listTemplates', () => {
    it('无模板时应返回空数组', () => {
      const mockDb = createMockDB([[]])
      vi.mocked(database.getDB).mockReturnValue(mockDb as never)

      expect(listTemplates()).toEqual([])
    })

    it('应正确返回模板列表', () => {
      const mockDb = createMockDB([
        [
          {
            columns: ['id', 'name', 'content', 'scope', 'book_id', 'created_at', 'updated_at'],
            values: [['tpl-1', '日记模板', '# 日记\n内容', 'global', null, 1000, 2000]],
          },
        ],
      ])
      vi.mocked(database.getDB).mockReturnValue(mockDb as never)

      const result = listTemplates()
      expect(result).toHaveLength(1)
      expect(result[0].name).toBe('日记模板')
      expect(result[0].scope).toBe('global')
      expect(result[0].bookId).toBeNull() // 数据库返回 null
    })
  })

  // ==================== createTemplate ====================
  describe('createTemplate', () => {
    it('应正确创建模板', () => {
      const mockDb = createMockDB()
      vi.mocked(database.getDB).mockReturnValue(mockDb as never)

      const result = createTemplate('会议记录', '## 会议内容', 'global')

      expect(result.name).toBe('会议记录')
      expect(result.scope).toBe('global')
      expect(mockDb.run).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO templates'),
        expect.anything(),
      )
    })
  })

  // ==================== deleteTemplate ====================
  describe('deleteTemplate', () => {
    it('应从数据库删除模板', () => {
      const mockDb = createMockDB()
      vi.mocked(database.getDB).mockReturnValue(mockDb as never)

      deleteTemplate('tpl-1')

      expect(mockDb.run).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM templates'),
        expect.arrayContaining(['tpl-1']),
      )
    })
  })
})
