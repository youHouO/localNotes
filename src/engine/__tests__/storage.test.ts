import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock storage modules
// ---------------------------------------------------------------------------

const mockOPFS = {
  initStorage: vi.fn(async () => {}),
  isStorageReady: vi.fn(() => true),
  readFile: vi.fn(async () => new Uint8Array([1, 2, 3])),
  writeFile: vi.fn(async () => {}),
  deleteFile: vi.fn(async () => {}),
  fileExists: vi.fn(async () => true),
  listDirectory: vi.fn(async () => ['file1.txt', 'file2.txt']),
  createDirectory: vi.fn(async () => {}),
  moveFile: vi.fn(async () => {}),
  deleteDirectory: vi.fn(async () => {}),
}

const mockFSA = {
  initStorage: vi.fn(async () => {
    throw new Error('FSA not available')
  }),
  isStorageReady: vi.fn(() => true),
  readFile: vi.fn(async () => new Uint8Array([4, 5, 6])),
  writeFile: vi.fn(async () => {}),
  deleteFile: vi.fn(async () => {}),
  fileExists: vi.fn(async () => true),
  listDirectory: vi.fn(async () => ['fsaa-file.txt']),
  createDirectory: vi.fn(async () => {}),
  moveFile: vi.fn(async () => {}),
  deleteDirectory: vi.fn(async () => {}),
}

vi.mock('../storage-opfs', () => ({ default: mockOPFS, ...mockOPFS }))
vi.mock('../storage-fsaa', () => ({ default: mockFSA, ...mockFSA }))

// ---------------------------------------------------------------------------
// 导入被测模块（必须在 vi.mock 之后）
// （仅用于类型引用，实际测试通过 getFreshStorage() 获取全新模块实例）
// ---------------------------------------------------------------------------

import type { StorageBackend } from '../storage'

// ---------------------------------------------------------------------------
// 辅助：重置模块内部状态
// ---------------------------------------------------------------------------

/**
 * storage.ts 的内部状态是模块级别的单例，测试之间需要隔离。
 * 由于 vitest 模块缓存机制，我们通过 vi.resetModules() + 动态 import
 * 来获取全新的模块实例。这里用一个 helper 来简化。
 */
async function getFreshStorage() {
  vi.resetModules()
  return await import('../storage')
}

// ---------------------------------------------------------------------------
// 原始 navigator.storage 引用（用于恢复）
// ---------------------------------------------------------------------------
const originalNavigatorStorage = navigator.storage

// ---------------------------------------------------------------------------
// 测试
// ---------------------------------------------------------------------------

describe('storage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Mock navigator.storage.getDirectory 以便 doInit 能走到 OPFS 降级路径
    Object.defineProperty(navigator, 'storage', {
      value: {
        ...originalNavigatorStorage,
        getDirectory: vi.fn(async () => ({})),
      },
      writable: true,
      configurable: true,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    // 恢复原始 navigator.storage
    Object.defineProperty(navigator, 'storage', {
      value: originalNavigatorStorage,
      writable: true,
      configurable: true,
    })
  })

  // =========================================================================
  // 1. initStorage 并发锁测试
  // =========================================================================
  describe('initStorage 并发锁', () => {
    it('多次调用 initStorage 只执行一次初始化', async () => {
      const mod = await getFreshStorage()
      await mod.initStorage()
      await mod.initStorage()
      await mod.initStorage()

      // OPFS initStorage 只应被调用一次
      expect(mockOPFS.initStorage).toHaveBeenCalledTimes(1)
    })

    it('并发调用 initStorage 只执行一次初始化', async () => {
      const mod = await getFreshStorage()
      await Promise.all([mod.initStorage(), mod.initStorage(), mod.initStorage()])

      expect(mockOPFS.initStorage).toHaveBeenCalledTimes(1)
    })

    it('初始化失败后 initPromise 被清空，可以重试', async () => {
      // 让 OPFS 也失败，这样 initStorage 会抛错
      mockOPFS.initStorage.mockRejectedValueOnce(new Error('OPFS fail'))

      const mod = await getFreshStorage()
      await expect(mod.initStorage()).rejects.toThrow('OPFS fail')

      // 恢复 OPFS
      mockOPFS.initStorage.mockResolvedValueOnce(undefined)

      // 重试应该成功
      await mod.initStorage()
      expect(mockOPFS.initStorage).toHaveBeenCalledTimes(2)
    })

    it('初始化失败后重试，fallbackReason 保持不变（来自 FSA 检测阶段）', async () => {
      mockOPFS.initStorage.mockRejectedValueOnce(new Error('OPFS fail'))

      const mod = await getFreshStorage()
      await expect(mod.initStorage()).rejects.toThrow('OPFS fail')

      // fallbackReason 应该已经被设置（因为 FSA API 不可用）
      const reason = mod.getFallbackReason()
      expect(reason).toBe('当前浏览器不支持文件系统访问 API')

      // 恢复 OPFS 并重试
      mockOPFS.initStorage.mockResolvedValueOnce(undefined)
      await mod.initStorage()
      expect(mod.getStorageBackend()).toBe('opfs')
    })
  })

  // =========================================================================
  // 2. getFallbackReason 测试
  // =========================================================================
  describe('getFallbackReason', () => {
    it('FSA API 不可用时记录降级原因', async () => {
      const mod = await getFreshStorage()
      // happy-dom 环境中 window 存在但没有 showDirectoryPicker
      // 所以 doInit 会设置 fallbackReason
      await mod.initStorage()

      expect(mod.getFallbackReason()).toBe('当前浏览器不支持文件系统访问 API')
    })

    it('未初始化时 fallbackReason 为 null', async () => {
      const mod = await getFreshStorage()
      expect(mod.getFallbackReason()).toBeNull()
    })

    it('强制使用 fsaa 后端时 fallbackReason 为 null', async () => {
      // 让 FSA mock 成功
      mockFSA.initStorage.mockResolvedValueOnce(undefined)

      const mod = await getFreshStorage()
      await mod.initStorageWithBackend('fsaa')

      expect(mod.getFallbackReason()).toBeNull()
    })
  })

  // =========================================================================
  // 3. getStorageBackend 测试
  // =========================================================================
  describe('getStorageBackend', () => {
    it('降级到 OPFS 后返回 opfs', async () => {
      const mod = await getFreshStorage()
      await mod.initStorage()

      expect(mod.getStorageBackend()).toBe('opfs')
    })

    it('未初始化时返回 null', async () => {
      const mod = await getFreshStorage()
      expect(mod.getStorageBackend()).toBeNull()
    })

    it('强制使用 fsaa 后端时返回 fsaa', async () => {
      mockFSA.initStorage.mockResolvedValueOnce(undefined)

      const mod = await getFreshStorage()
      await mod.initStorageWithBackend('fsaa')

      expect(mod.getStorageBackend()).toBe('fsaa')
    })
  })

  // =========================================================================
  // 4. initStorageWithBackend 测试
  // =========================================================================
  describe('initStorageWithBackend', () => {
    it('强制使用 opfs 后端', async () => {
      const mod = await getFreshStorage()
      await mod.initStorageWithBackend('opfs')

      expect(mod.getStorageBackend()).toBe('opfs')
      expect(mockOPFS.initStorage).toHaveBeenCalledTimes(1)
      expect(mockFSA.initStorage).not.toHaveBeenCalled()
    })

    it('强制使用 fsaa 后端', async () => {
      mockFSA.initStorage.mockResolvedValueOnce(undefined)

      const mod = await getFreshStorage()
      await mod.initStorageWithBackend('fsaa')

      expect(mod.getStorageBackend()).toBe('fsaa')
      expect(mockFSA.initStorage).toHaveBeenCalledTimes(1)
      expect(mockOPFS.initStorage).not.toHaveBeenCalled()
    })

    it('强制使用 fsaa 后端时 fallbackReason 被清空', async () => {
      // 先走正常降级路径
      const mod = await getFreshStorage()
      await mod.initStorage()
      expect(mod.getFallbackReason()).toBe('当前浏览器不支持文件系统访问 API')

      // 再强制切换到 fsaa
      mockFSA.initStorage.mockResolvedValueOnce(undefined)
      await mod.initStorageWithBackend('fsaa')

      expect(mod.getFallbackReason()).toBeNull()
      expect(mod.getStorageBackend()).toBe('fsaa')
    })
  })

  // =========================================================================
  // 5. 代理函数测试
  // =========================================================================
  describe('代理函数', () => {
    let mod: Awaited<ReturnType<typeof getFreshStorage>>

    beforeEach(async () => {
      mod = await getFreshStorage()
      await mod.initStorage()
    })

    it('readFile 正确代理到 cachedModule', async () => {
      const data = await mod.readFile('test.txt')
      expect(data).toEqual(new Uint8Array([1, 2, 3]))
      expect(mockOPFS.readFile).toHaveBeenCalledWith('test.txt')
    })

    it('writeFile 正确代理到 cachedModule', async () => {
      const content = new Uint8Array([10, 20, 30])
      await mod.writeFile('output.txt', content)
      expect(mockOPFS.writeFile).toHaveBeenCalledWith('output.txt', content)
    })

    it('writeFile 支持字符串内容', async () => {
      await mod.writeFile('hello.txt', 'hello world')
      expect(mockOPFS.writeFile).toHaveBeenCalledWith('hello.txt', 'hello world')
    })

    it('deleteFile 正确代理到 cachedModule', async () => {
      await mod.deleteFile('remove.txt')
      expect(mockOPFS.deleteFile).toHaveBeenCalledWith('remove.txt')
    })

    it('fileExists 正确代理到 cachedModule', async () => {
      const exists = await mod.fileExists('check.txt')
      expect(exists).toBe(true)
      expect(mockOPFS.fileExists).toHaveBeenCalledWith('check.txt')
    })

    it('listDirectory 正确代理到 cachedModule', async () => {
      const files = await mod.listDirectory('/notes')
      expect(files).toEqual(['file1.txt', 'file2.txt'])
      expect(mockOPFS.listDirectory).toHaveBeenCalledWith('/notes')
    })

    it('createDirectory 正确代理到 cachedModule', async () => {
      await mod.createDirectory('/notes/new-folder')
      expect(mockOPFS.createDirectory).toHaveBeenCalledWith('/notes/new-folder')
    })

    it('moveFile 正确代理到 cachedModule', async () => {
      await mod.moveFile('/notes/old.txt', '/notes/new.txt')
      expect(mockOPFS.moveFile).toHaveBeenCalledWith('/notes/old.txt', '/notes/new.txt')
    })

    it('deleteDirectory 正确代理到 cachedModule', async () => {
      await mod.deleteDirectory('/notes/old-folder')
      expect(mockOPFS.deleteDirectory).toHaveBeenCalledWith('/notes/old-folder')
    })

    it('存储未初始化时调用 readFile 抛出错误', async () => {
      const freshMod = await getFreshStorage()
      // 不调用 initStorage
      await expect(freshMod.readFile('test.txt')).rejects.toThrow('存储未初始化')
    })

    it('存储未初始化时调用 writeFile 抛出错误', async () => {
      const freshMod = await getFreshStorage()
      await expect(freshMod.writeFile('test.txt', 'data')).rejects.toThrow('存储未初始化')
    })

    it('存储未初始化时调用 deleteFile 抛出错误', async () => {
      const freshMod = await getFreshStorage()
      await expect(freshMod.deleteFile('test.txt')).rejects.toThrow('存储未初始化')
    })

    it('存储未初始化时调用 fileExists 抛出错误', async () => {
      const freshMod = await getFreshStorage()
      await expect(freshMod.fileExists('test.txt')).rejects.toThrow('存储未初始化')
    })

    it('存储未初始化时调用 listDirectory 抛出错误', async () => {
      const freshMod = await getFreshStorage()
      await expect(freshMod.listDirectory('/')).rejects.toThrow('存储未初始化')
    })

    it('存储未初始化时调用 createDirectory 抛出错误', async () => {
      const freshMod = await getFreshStorage()
      await expect(freshMod.createDirectory('/new')).rejects.toThrow('存储未初始化')
    })

    it('存储未初始化时调用 moveFile 抛出错误', async () => {
      const freshMod = await getFreshStorage()
      await expect(freshMod.moveFile('/a', '/b')).rejects.toThrow('存储未初始化')
    })

    it('存储未初始化时调用 deleteDirectory 抛出错误', async () => {
      const freshMod = await getFreshStorage()
      await expect(freshMod.deleteDirectory('/dir')).rejects.toThrow('存储未初始化')
    })
  })

  // =========================================================================
  // 6. isStorageReady 测试
  // =========================================================================
  describe('isStorageReady', () => {
    it('初始化后返回 true', async () => {
      const mod = await getFreshStorage()
      await mod.initStorage()

      expect(mod.isStorageReady()).toBe(true)
    })

    it('未初始化返回 false', async () => {
      const mod = await getFreshStorage()
      expect(mod.isStorageReady()).toBe(false)
    })

    it('使用 initStorageWithBackend 初始化后返回 true', async () => {
      const mod = await getFreshStorage()
      await mod.initStorageWithBackend('opfs')

      expect(mod.isStorageReady()).toBe(true)
    })
  })
})
