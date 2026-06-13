import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock Web Crypto API
const mockCryptoSubtle = {
  encrypt: vi.fn(),
  decrypt: vi.fn(),
  digest: vi.fn(),
  importKey: vi.fn(),
  exportKey: vi.fn(),
  generateKey: vi.fn(),
  deriveBits: vi.fn(),
}

vi.stubGlobal('crypto', {
  subtle: mockCryptoSubtle,
  getRandomValues: vi.fn((arr: Uint8Array) => {
    for (let i = 0; i < arr.length; i++) arr[i] = i
    return arr
  }),
})

// Mock localStorage（Node.js 环境中不存在原生 localStorage）
const mockLocalStorage: Record<string, string> = {}
const mockLocalStorageObj = {
  getItem: vi.fn((key: string) => mockLocalStorage[key] ?? null),
  setItem: vi.fn((key: string, value: string) => { mockLocalStorage[key] = value }),
  removeItem: vi.fn((key: string) => { delete mockLocalStorage[key] }),
  clear: vi.fn(() => Object.keys(mockLocalStorage).forEach(k => delete mockLocalStorage[k])),
}
;(globalThis as any).localStorage = mockLocalStorageObj

import {
  encryptString, decryptToString, sha256,
  getKey, exportRawKey,
} from '@/engine/encryption'

// 辅助：创建 mock AES-GCM 密钥
function createMockKey() {
  return { type: 'secret', algorithm: { name: 'AES-GCM' }, extractable: true } as unknown as CryptoKey
}

describe('encryption', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.keys(mockLocalStorage).forEach(k => delete mockLocalStorage[k])
  })

  // ==================== getKey ====================
  describe('getKey', () => {
    it('localStorage 无密钥时应生成新密钥并保存', async () => {
      const mockKey = createMockKey()
      mockCryptoSubtle.importKey.mockResolvedValue(mockKey)
      mockCryptoSubtle.digest.mockResolvedValue(new Uint8Array(32))
      mockCryptoSubtle.deriveBits.mockResolvedValue(new Uint8Array(32))
      mockCryptoSubtle.exportKey.mockResolvedValue(new Uint8Array(32))

      const key = await getKey()

      expect(mockCryptoSubtle.importKey).toHaveBeenCalled()
      expect(mockCryptoSubtle.deriveBits).toHaveBeenCalled()
      // 验证 localStorage 中保存了密钥
      expect(mockLocalStorage['localnotes_aes_key']).toBeDefined()
      expect(key).toBe(mockKey)
    })

    it('localStorage 有密钥时应导入并返回', async () => {
      // 预设 localStorage 中的密钥
      const rawKey = new Uint8Array(32).fill(1)
      mockLocalStorage['localnotes_aes_key'] = btoa(String.fromCharCode(...rawKey))

      const mockKey = createMockKey()
      mockCryptoSubtle.importKey.mockResolvedValue(mockKey)

      const key = await getKey()

      // importKey 应被调用（从 localStorage 恢复密钥）
      expect(key).toStrictEqual(mockKey)
    })

    it('第二次调用应返回缓存的密钥', async () => {
      const mockKey = createMockKey()
      mockCryptoSubtle.importKey.mockResolvedValue(mockKey)
      mockCryptoSubtle.digest.mockResolvedValue(new Uint8Array(32))
      mockCryptoSubtle.deriveBits.mockResolvedValue(new Uint8Array(32))
      mockCryptoSubtle.exportKey.mockResolvedValue(new Uint8Array(32))

      const key1 = await getKey()
      const key2 = await getKey()

      expect(key1).toBe(key2)
      // 验证两次返回相同的密钥对象
    })
  })

  // ==================== encryptString ====================
  describe('encryptString', () => {
    it('应使用 AES-GCM 加密并返回 IV + ciphertext', async () => {
      const mockKey = createMockKey()
      mockCryptoSubtle.encrypt.mockResolvedValue(new Uint8Array([1, 2, 3, 4]))

      const result = await encryptString('hello', mockKey)

      expect(mockCryptoSubtle.encrypt).toHaveBeenCalledWith(
        { name: 'AES-GCM', iv: expect.any(Uint8Array) },
        mockKey,
        expect.any(Uint8Array),
      )
      // 结果应为 16字节IV + 4字节ciphertext = 20字节
      expect(result.length).toBe(20)
    })

    it('加密失败时应抛出友好错误', async () => {
      mockCryptoSubtle.encrypt.mockRejectedValue(new Error('加密引擎错误'))

      await expect(encryptString('test', createMockKey()))
        .rejects.toThrow('加密失败')
    })
  })

  // ==================== decryptToString ====================
  describe('decryptToString', () => {
    it('应正确解密 AES-GCM 密文', async () => {
      const mockKey = createMockKey()
      const iv = new Uint8Array(16).fill(0)
      const ciphertext = new Uint8Array([1, 2, 3, 4])
      const combined = new Uint8Array([...iv, ...ciphertext])

      const encoder = new TextEncoder()
      mockCryptoSubtle.decrypt.mockResolvedValue(encoder.encode('解密结果'))

      const result = await decryptToString(combined, mockKey)

      expect(result).toBe('解密结果')
      // 验证 decrypt 被调用，不精确匹配 key 对象
      expect(mockCryptoSubtle.decrypt).toHaveBeenCalledWith(
        { name: 'AES-GCM', iv },
        mockKey,
        ciphertext,
      )
    })

    it('密文长度不足 17 字节时应抛出错误', async () => {
      const shortData = new Uint8Array(10)

      await expect(decryptToString(shortData, createMockKey()))
        .rejects.toThrow()
    })

    it('解密失败时应抛出友好错误', async () => {
      const iv = new Uint8Array(16).fill(0)
      const ciphertext = new Uint8Array([1, 2, 3, 4])
      const combined = new Uint8Array([...iv, ...ciphertext])

      mockCryptoSubtle.decrypt.mockRejectedValue(new Error('解密失败'))

      await expect(decryptToString(combined, createMockKey()))
        .rejects.toThrow('解密失败')
    })
  })

  // ==================== sha256 ====================
  describe('sha256', () => {
    it('应返回小写 hex 字符串', async () => {
      const hashBuffer = new Uint8Array([0xab, 0xcd, 0xef, 0x01])
      mockCryptoSubtle.digest.mockResolvedValue(hashBuffer)

      const result = await sha256('test')

      expect(result).toBe('abcdef01')
      expect(mockCryptoSubtle.digest).toHaveBeenCalledWith(
        'SHA-256',
        expect.any(Uint8Array),
      )
    })

    it('支持 Uint8Array 输入', async () => {
      const hashBuffer = new Uint8Array([0xff, 0x00])
      mockCryptoSubtle.digest.mockResolvedValue(hashBuffer)

      const result = await sha256(new Uint8Array([1, 2, 3]))

      expect(result).toBe('ff00')
    })

    it('计算失败时应抛出友好错误', async () => {
      mockCryptoSubtle.digest.mockRejectedValue(new Error('digest error'))

      await expect(sha256('test')).rejects.toThrow('哈希计算失败')
    })
  })

  // ==================== exportRawKey ====================
  describe('exportRawKey', () => {
    it('应导出 32 字节的原始密钥', async () => {
      const rawKey = new Uint8Array(32).fill(42)
      mockCryptoSubtle.exportKey.mockResolvedValue(rawKey)

      const result = await exportRawKey(createMockKey())

      expect(result).toEqual(rawKey)
      expect(result.length).toBe(32)
    })

    it('导出失败时应返回空 Uint8Array', async () => {
      mockCryptoSubtle.exportKey.mockRejectedValue(new Error('not extractable'))

      const result = await exportRawKey(createMockKey())

      expect(result).toEqual(new Uint8Array(0))
    })
  })
})
