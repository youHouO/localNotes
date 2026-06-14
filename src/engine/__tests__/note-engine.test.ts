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

// ==================== Imports (after mocks) ====================
import {
  listBooks, getBook, createBook, renameBook, deleteBook,
  listVolumes, getVolume, createVolume, renameVolume, deleteVolume,
  listNotes, createNote, getNote, renameNote, deleteNote,
  searchNotes,
  listTrash, restoreFromTrash, permanentDelete, cleanExpiredTrash,
  listTemplates, createTemplate, updateTemplate, deleteTemplate,
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

  // ==================== 异常分支：存储未就绪 ====================
  describe('存储未就绪时的异常行为', () => {
    it('listBooks 应抛出 "存储未初始化"', () => {
      vi.mocked(storage.isStorageReady).mockReturnValue(false)
      expect(() => listBooks()).toThrow('存储未初始化')
    })

    it('getBook 应抛出 "存储未初始化"', () => {
      vi.mocked(storage.isStorageReady).mockReturnValue(false)
      expect(() => getBook('any-id')).toThrow('存储未初始化')
    })

    it('createBook 应抛出 "存储未初始化"', async () => {
      vi.mocked(storage.isStorageReady).mockReturnValue(false)
      await expect(createBook('书名')).rejects.toThrow('存储未初始化')
    })

    it('renameBook 应抛出 "存储未初始化"', async () => {
      vi.mocked(storage.isStorageReady).mockReturnValue(false)
      await expect(renameBook('id', '新名')).rejects.toThrow('存储未初始化')
    })

    it('deleteBook 应抛出 "存储未初始化"', async () => {
      vi.mocked(storage.isStorageReady).mockReturnValue(false)
      await expect(deleteBook('id')).rejects.toThrow('存储未初始化')
    })

    it('listVolumes 应抛出 "存储未初始化"', () => {
      vi.mocked(storage.isStorageReady).mockReturnValue(false)
      expect(() => listVolumes('book-id')).toThrow('存储未初始化')
    })

    it('createVolume 应抛出 "存储未初始化"', async () => {
      vi.mocked(storage.isStorageReady).mockReturnValue(false)
      await expect(createVolume('book-id', '卷名')).rejects.toThrow('存储未初始化')
    })

    it('renameVolume 应抛出 "存储未初始化"', async () => {
      vi.mocked(storage.isStorageReady).mockReturnValue(false)
      await expect(renameVolume('id', '新名')).rejects.toThrow('存储未初始化')
    })

    it('deleteVolume 应抛出 "存储未初始化"', async () => {
      vi.mocked(storage.isStorageReady).mockReturnValue(false)
      await expect(deleteVolume('id')).rejects.toThrow('存储未初始化')
    })

    it('listNotes 应抛出 "存储未初始化"', () => {
      vi.mocked(storage.isStorageReady).mockReturnValue(false)
      expect(() => listNotes('vol-id')).toThrow('存储未初始化')
    })

    it('getNote 应抛出 "存储未初始化"', () => {
      vi.mocked(storage.isStorageReady).mockReturnValue(false)
      expect(() => getNote('id')).toThrow('存储未初始化')
    })

    it('createNote 应抛出 "存储未初始化"', async () => {
      vi.mocked(storage.isStorageReady).mockReturnValue(false)
      await expect(createNote('vol-id', '标题')).rejects.toThrow('存储未初始化')
    })

    it('renameNote 应抛出 "存储未初始化"', async () => {
      vi.mocked(storage.isStorageReady).mockReturnValue(false)
      await expect(renameNote('id', '新标题')).rejects.toThrow('存储未初始化')
    })

    it('deleteNote 应抛出 "存储未初始化"', async () => {
      vi.mocked(storage.isStorageReady).mockReturnValue(false)
      await expect(deleteNote('id')).rejects.toThrow('存储未初始化')
    })

    it('searchNotes 应抛出 "存储未初始化"', () => {
      vi.mocked(storage.isStorageReady).mockReturnValue(false)
      expect(() => searchNotes('关键词')).toThrow('存储未初始化')
    })

    it('listTrash 应抛出 "存储未初始化"', () => {
      vi.mocked(storage.isStorageReady).mockReturnValue(false)
      expect(() => listTrash()).toThrow('存储未初始化')
    })

    it('restoreFromTrash 应抛出 "存储未初始化"', async () => {
      vi.mocked(storage.isStorageReady).mockReturnValue(false)
      await expect(restoreFromTrash('id', 'note')).rejects.toThrow('存储未初始化')
    })

    it('permanentDelete 应抛出 "存储未初始化"', async () => {
      vi.mocked(storage.isStorageReady).mockReturnValue(false)
      await expect(permanentDelete('id', 'note')).rejects.toThrow('存储未初始化')
    })

    it('cleanExpiredTrash 应抛出 "存储未初始化"', async () => {
      vi.mocked(storage.isStorageReady).mockReturnValue(false)
      await expect(cleanExpiredTrash()).rejects.toThrow('存储未初始化')
    })

    it('listTemplates 应抛出 "存储未初始化"', () => {
      vi.mocked(storage.isStorageReady).mockReturnValue(false)
      expect(() => listTemplates()).toThrow('存储未初始化')
    })

    it('createTemplate 应抛出 "存储未初始化"', async () => {
      vi.mocked(storage.isStorageReady).mockReturnValue(false)
      await expect(createTemplate('名', '内容')).rejects.toThrow('存储未初始化')
    })

    it('updateTemplate 应抛出 "存储未初始化"', async () => {
      vi.mocked(storage.isStorageReady).mockReturnValue(false)
      await expect(updateTemplate('id', '名', '内容')).rejects.toThrow('存储未初始化')
    })

    it('deleteTemplate 应抛出 "存储未初始化"', async () => {
      vi.mocked(storage.isStorageReady).mockReturnValue(false)
      await expect(deleteTemplate('id')).rejects.toThrow('存储未初始化')
    })
  })

  // ==================== listBooks ====================
  describe('listBooks', () => {
    it('数据库无结果时应返回空数组', () => {
      const mockDb = createMockDB([[]])
      vi.mocked(database.getDB).mockReturnValue(mockDb as never)
      expect(listBooks()).toEqual([])
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

      listBooks('createdAt')
      const sql = mockDb.exec.mock.calls[0][0] as string
      expect(sql).toContain('created_at DESC')
    })
  })

  // ==================== getBook ====================
  describe('getBook', () => {
    it('书不存在时应返回 null', () => {
      const mockDb = createMockDB([[]])
      vi.mocked(database.getDB).mockReturnValue(mockDb as never)
      expect(getBook('non-existent-id')).toBeNull()
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
    it('应正确创建书并返回 Book 对象', async () => {
      const mockDb = createMockDB()
      vi.mocked(database.getDB).mockReturnValue(mockDb as never)

      const result = await createBook('新书')
      expect(result.name).toBe('新书')
      expect(result.id).toBeDefined()
      expect(result.createdAt).toBeGreaterThan(0)
      expect(mockDb.run).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO books'),
        expect.arrayContaining([expect.any(String), '新书', expect.any(Number), expect.any(Number), 0]),
      )
    })

    it('空书名应允许创建（业务层不拦截）', async () => {
      const mockDb = createMockDB()
      vi.mocked(database.getDB).mockReturnValue(mockDb as never)
      const result = await createBook('')
      expect(result.name).toBe('')
    })

    it('超长书名应允许创建（数据库层限制）', async () => {
      const mockDb = createMockDB()
      vi.mocked(database.getDB).mockReturnValue(mockDb as never)
      const longName = 'a'.repeat(1000)
      const result = await createBook(longName)
      expect(result.name).toBe(longName)
    })
  })

  // ==================== renameBook ====================
  describe('renameBook', () => {
    it('应执行 UPDATE SQL', async () => {
      const mockDb = createMockDB()
      vi.mocked(database.getDB).mockReturnValue(mockDb as never)

      await renameBook('book-1', '新名字')

      expect(mockDb.run).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE books SET name'),
        expect.arrayContaining(['新名字', expect.any(Number), 'book-1']),
      )
    })

    it('重命名为空字符串应执行 UPDATE', async () => {
      const mockDb = createMockDB()
      vi.mocked(database.getDB).mockReturnValue(mockDb as never)
      await renameBook('book-1', '')
      expect(mockDb.run).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE books SET name'),
        expect.arrayContaining(['', expect.any(Number), 'book-1']),
      )
    })
  })

  // ==================== deleteBook ====================
  describe('deleteBook', () => {
    it('应删除书及相关卷和笔记', async () => {
      const mockDb = createMockDB()
      vi.mocked(database.getDB).mockReturnValue(mockDb as never)

      await deleteBook('book-1')

      expect(mockDb.run).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM notes'),
        expect.arrayContaining(['book-1']),
      )
      expect(mockDb.run).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM volumes'),
        expect.arrayContaining(['book-1']),
      )
      expect(mockDb.run).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM books'),
        expect.arrayContaining(['book-1']),
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

    it('书无卷时应返回空数组', () => {
      const mockDb = createMockDB([[]])
      vi.mocked(database.getDB).mockReturnValue(mockDb as never)
      expect(listVolumes('book-empty')).toEqual([])
    })
  })

  // ==================== createVolume ====================
  describe('createVolume', () => {
    it('应正确创建卷', async () => {
      const mockDb = createMockDB()
      vi.mocked(database.getDB).mockReturnValue(mockDb as never)

      const result = await createVolume('book-1', '新卷')
      expect(result.name).toBe('新卷')
      expect(result.bookId).toBe('book-1')
      expect(mockDb.run).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO volumes'),
        expect.anything(),
      )
    })

    it('空卷名应允许创建', async () => {
      const mockDb = createMockDB()
      vi.mocked(database.getDB).mockReturnValue(mockDb as never)
      const result = await createVolume('book-1', '')
      expect(result.name).toBe('')
    })
  })

  // ==================== renameVolume ====================
  describe('renameVolume', () => {
    it('应执行 UPDATE SQL', async () => {
      const mockDb = createMockDB()
      vi.mocked(database.getDB).mockReturnValue(mockDb as never)
      await renameVolume('vol-1', '新卷名')
      expect(mockDb.run).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE volumes SET name'),
        expect.anything(),
      )
    })
  })

  // ==================== deleteVolume ====================
  describe('deleteVolume', () => {
    it('应将卷及笔记移入回收站', async () => {
      const mockDb = createMockDB([
        // getVolume 查询
        [
          {
            columns: ['id', 'book_id', 'name', 'created_at', 'updated_at', 'note_count', 'sort_order'],
            values: [['vol-1', 'book-1', '卷名', 1000, 2000, 0, 0]],
          },
        ],
        // listNotes 查询（空）—— 需要返回标准格式
        [],
      ])
      vi.mocked(database.getDB).mockReturnValue(mockDb as never)
      await deleteVolume('vol-1')
      // 卷被移入 trash
      expect(mockDb.run).toHaveBeenCalledWith(
        expect.stringContaining('INSERT OR REPLACE INTO trash'),
        expect.arrayContaining(['vol-1', 'volume', '卷名']),
      )
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

    it('卷无笔记时应返回空数组', () => {
      const mockDb = createMockDB([[]])
      vi.mocked(database.getDB).mockReturnValue(mockDb as never)
      expect(listNotes('vol-empty')).toEqual([])
    })
  })

  // ==================== getNote ====================
  describe('getNote', () => {
    it('笔记不存在时应返回 null', () => {
      const mockDb = createMockDB([[]])
      vi.mocked(database.getDB).mockReturnValue(mockDb as never)
      expect(getNote('non-existent')).toBeNull()
    })

    it('笔记存在时应返回 Note 对象', () => {
      const mockDb = createMockDB([
        [
          {
            columns: ['id', 'volume_id', 'book_id', 'title', 'content_hash', 'created_at', 'updated_at', 'word_count', 'image_count'],
            values: [['note-1', 'vol-1', 'book-1', '标题', 'hash', 1000, 2000, 50, 0]],
          },
        ],
      ])
      vi.mocked(database.getDB).mockReturnValue(mockDb as never)
      const result = getNote('note-1')
      expect(result).not.toBeNull()
      expect(result!.title).toBe('标题')
    })
  })

  // ==================== createNote ====================
  describe('createNote', () => {
    it('卷不存在时应抛出错误', async () => {
      const mockDb = createMockDB([[]])
      vi.mocked(database.getDB).mockReturnValue(mockDb as never)
      await expect(createNote('vol-nonexist', '标题')).rejects.toThrow('卷不存在')
    })

    it('应正确创建笔记', async () => {
      const mockDb = createMockDB([
        // getVolume 查询结果
        [
          {
            columns: ['id', 'book_id', 'name', 'created_at', 'updated_at', 'note_count', 'sort_order'],
            values: [['vol-1', 'book-1', '卷', 1000, 2000, 0, 0]],
          },
        ],
      ])
      vi.mocked(database.getDB).mockReturnValue(mockDb as never)

      const result = await createNote('vol-1', '新笔记')
      expect(result.title).toBe('新笔记')
      expect(result.volumeId).toBe('vol-1')
      expect(result.bookId).toBe('book-1')
      expect(mockDb.run).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO notes'),
        expect.anything(),
      )
    })

    it('空标题应允许创建', async () => {
      const mockDb = createMockDB([
        [
          {
            columns: ['id', 'book_id', 'name', 'created_at', 'updated_at', 'note_count', 'sort_order'],
            values: [['vol-1', 'book-1', '卷', 1000, 2000, 0, 0]],
          },
        ],
      ])
      vi.mocked(database.getDB).mockReturnValue(mockDb as never)
      const result = await createNote('vol-1', '')
      expect(result.title).toBe('')
    })

    it('超长标题应允许创建', async () => {
      const mockDb = createMockDB([
        [
          {
            columns: ['id', 'book_id', 'name', 'created_at', 'updated_at', 'note_count', 'sort_order'],
            values: [['vol-1', 'book-1', '卷', 1000, 2000, 0, 0]],
          },
        ],
      ])
      vi.mocked(database.getDB).mockReturnValue(mockDb as never)
      const longTitle = 'a'.repeat(1000)
      const result = await createNote('vol-1', longTitle)
      expect(result.title).toBe(longTitle)
    })
  })

  // ==================== renameNote ====================
  describe('renameNote', () => {
    it('应执行 UPDATE SQL', async () => {
      const mockDb = createMockDB()
      vi.mocked(database.getDB).mockReturnValue(mockDb as never)
      await renameNote('note-1', '新标题')
      expect(mockDb.run).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE notes SET title'),
        expect.anything(),
      )
    })
  })

  // ==================== deleteNote ====================
  describe('deleteNote', () => {
    it('应删除笔记并更新计数', async () => {
      const mockDb = createMockDB([
        // getNote 查询
        [
          {
            columns: ['id', 'volume_id', 'book_id', 'title', 'content_hash', 'created_at', 'updated_at', 'word_count', 'image_count'],
            values: [['note-1', 'vol-1', 'book-1', '标题', 'hash', 1000, 2000, 50, 0]],
          },
        ],
      ])
      vi.mocked(database.getDB).mockReturnValue(mockDb as never)

      await deleteNote('note-1')
      expect(mockDb.run).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM notes'),
        expect.arrayContaining(['note-1']),
      )
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
      const sql = mockDb.exec.mock.calls[0][0] as string
      expect(sql).toContain('LIKE')
    })

    it('FTS5 可用时应使用 FTS 查询', () => {
      vi.mocked(database.isFTS5Available).mockReturnValue(true)
      const mockDb = createMockDB([
        [
          {
            columns: ['note_id', 'note_title', 'volume_id', 'volume_name', 'book_id', 'book_name', 'snippet'],
            values: [['note-1', 'FTS测试', 'vol-1', '卷A', 'book-1', '我的书', 'FTS测试内容...']],
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

      searchNotes('标题', undefined, 10)
      const sql = mockDb.exec.mock.calls[0][0] as string
      expect(sql).toContain('LIMIT')
      const params = mockDb.exec.mock.calls[0][1] as unknown[]
      expect(params).toContain(10)
    })

    it('limit 为 0 时应返回空数组（SQL LIMIT 0）', () => {
      vi.mocked(database.isFTS5Available).mockReturnValue(false)
      const mockDb = createMockDB([[]])
      vi.mocked(database.getDB).mockReturnValue(mockDb as never)
      const result = searchNotes('测试', undefined, 0)
      const sql = mockDb.exec.mock.calls[0][0] as string
      expect(sql).toContain('LIMIT')
      const params = mockDb.exec.mock.calls[0][1] as unknown[]
      expect(params).toContain(0)
    })

    it('关键词含 SQL 特殊字符时应正常搜索', () => {
      vi.mocked(database.isFTS5Available).mockReturnValue(false)
      const mockDb = createMockDB([[]])
      vi.mocked(database.getDB).mockReturnValue(mockDb as never)
      searchNotes('%测试_')
      const params = mockDb.exec.mock.calls[0][1] as unknown[]
      expect(params[0]).toBe('%\%测试\_%')
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
            columns: ['id', 'type', 'name', 'parent_id', 'deleted_at', 'expires_at', 'book_id'],
            values: [
              ['note-del-1', 'note', '已删除笔记', 'vol-1', nowMs - 60000, nowMs - 60000 + retentionMs, 'book-1'],
              ['vol-del-1', 'volume', '已删除卷', 'book-1', nowMs - 600000, nowMs - 600000 + retentionMs, 'book-1'],
              ['book-del-1', 'book', '已删除书', null, nowMs - 3600000, nowMs - 3600000 + retentionMs, null],
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
      const mockDb = createMockDB([[]])
      vi.mocked(database.getDB).mockReturnValue(mockDb as never)
      const result = listTrash()
      expect(result).toHaveLength(0)
      const sql = mockDb.exec.mock.calls[0][0] as string
      expect(sql).toContain('expires_at >')
    })
  })

  // ==================== restoreFromTrash ====================
  describe('restoreFromTrash', () => {
    it('条目不存在时应抛出错误', async () => {
      const mockDb = createMockDB([[]])
      vi.mocked(database.getDB).mockReturnValue(mockDb as never)
      await expect(restoreFromTrash('nonexist', 'note')).rejects.toThrow('回收站中不存在该项目')
    })

    it('应正确恢复笔记', async () => {
      const mockDb = createMockDB([
        [
          {
            columns: ['name', 'parent_id', 'deleted_at'],
            values: [['恢复笔记', 'vol-1', 1000000]],
          },
        ],
      ])
      vi.mocked(database.getDB).mockReturnValue(mockDb as never)

      await restoreFromTrash('note-1', 'note')
      expect(mockDb.run).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM trash'),
        expect.arrayContaining(['note-1']),
      )
      expect(mockDb.run).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO notes'),
        expect.arrayContaining(['note-1', '恢复笔记']),
      )
    })
  })

  // ==================== permanentDelete ====================
  describe('permanentDelete', () => {
    it('应从 trash 表删除记录', async () => {
      const mockDb = createMockDB([
        [{ columns: ['deleted_at'], values: [[1000000]] }],
      ])
      vi.mocked(database.getDB).mockReturnValue(mockDb as never)

      await permanentDelete('note-1', 'note')
      expect(mockDb.run).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM trash'),
        expect.arrayContaining(['note-1']),
      )
    })

    it('条目不存在时应静默处理', async () => {
      const mockDb = createMockDB([[]])
      vi.mocked(database.getDB).mockReturnValue(mockDb as never)
      await expect(permanentDelete('nonexist', 'note')).resolves.toBeUndefined()
    })
  })

  // ==================== cleanExpiredTrash ====================
  describe('cleanExpiredTrash', () => {
    it('无过期条目时应返回 0', async () => {
      const mockDb = createMockDB([[]])
      vi.mocked(database.getDB).mockReturnValue(mockDb as never)
      expect(await cleanExpiredTrash()).toBe(0)
    })

    it('应删除过期条目并返回数量', async () => {
      const mockDb = createMockDB([
        [{ columns: ['id', 'type', 'deleted_at'], values: [['n1', 'note', 1000], ['n2', 'note', 2000]] }],
      ])
      mockDb.getRowsModified = vi.fn().mockReturnValue(2)
      vi.mocked(database.getDB).mockReturnValue(mockDb as never)

      const count = await cleanExpiredTrash()
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
      expect(result[0].bookId).toBeNull()
    })
  })

  // ==================== createTemplate ====================
  describe('createTemplate', () => {
    it('应正确创建模板', async () => {
      const mockDb = createMockDB()
      vi.mocked(database.getDB).mockReturnValue(mockDb as never)

      const result = await createTemplate('会议记录', '## 会议内容', 'global')
      expect(result.name).toBe('会议记录')
      expect(result.scope).toBe('global')
      expect(mockDb.run).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO templates'),
        expect.anything(),
      )
    })

    it('空内容应允许创建', async () => {
      const mockDb = createMockDB()
      vi.mocked(database.getDB).mockReturnValue(mockDb as never)
      const result = await createTemplate('空模板', '', 'book')
      expect(result.name).toBe('空模板')
      expect(result.content).toBe('')
    })
  })

  // ==================== updateTemplate ====================
  describe('updateTemplate', () => {
    it('应执行 UPDATE SQL', async () => {
      const mockDb = createMockDB()
      vi.mocked(database.getDB).mockReturnValue(mockDb as never)
      await updateTemplate('tpl-1', '新名', '新内容')
      expect(mockDb.run).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE templates SET'),
        expect.anything(),
      )
    })
  })

  // ==================== deleteTemplate ====================
  describe('deleteTemplate', () => {
    it('应从数据库删除模板', async () => {
      const mockDb = createMockDB()
      vi.mocked(database.getDB).mockReturnValue(mockDb as never)
      await deleteTemplate('tpl-1')
      expect(mockDb.run).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM templates'),
        expect.arrayContaining(['tpl-1']),
      )
    })
  })
})
