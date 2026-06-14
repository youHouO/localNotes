/**
 * 加密模块
 * 基于 Web Crypto API 实现 AES-GCM 加密与 SHA-256 哈希
 *
 * 加密方案：所有用户统一使用软件内置固定密钥（PBKDF2 派生），
 * 保证数据不是明文存储即可，不需要用户设置/记住密码。
 */

// ============================================================
// 常量定义
// ============================================================

/**
 * 软件内置固定密码，用于 PBKDF2 派生统一密钥。
 *
 * 这是有意为之的设计决策：本应用定位为本地优先的轻量笔记工具，
 * 加密的目标是保证数据不是明文存储即可，而非抵御有针对性的攻击者。
 * 使用固定密钥意味着所有用户/设备共享同一密钥，因此：
 * - 不要将笔记文件分享给他人（他们理论上可以解密）
 * - 如需更强的安全保护，请自行在系统层面加密存储（如 BitLocker、FileVault）
 */
const BUILT_IN_PASSWORD = 'LocalNotes-Secure-Key-Derivation-2024'

/** PBKDF2 算法参数 */
const PBKDF2_PARAMS: Pbkdf2Params = {
  name: 'PBKDF2',
  salt: new TextEncoder().encode('LocalNotes-Salt-v1'),
  iterations: 100000,
  hash: 'SHA-256',
}

// ============================================================
// 模块级状态
// ============================================================

/** 缓存的 CryptoKey（避免重复派生） */
let cachedKey: CryptoKey | null = null

// ============================================================
// 核心函数
// ============================================================

/**
 * 获取统一的 AES-GCM 密钥
 *
 * 使用 PBKDF2 从软件内置固定密码派生 256 位 AES-GCM 密钥。
 * 所有用户/设备使用相同的密钥，保证数据不是明文即可。
 *
 * @returns AES-GCM CryptoKey
 */
export async function getKey(): Promise<CryptoKey> {
  if (cachedKey) {
    return cachedKey
  }

  try {
    const passwordKey = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(BUILT_IN_PASSWORD),
      { name: 'PBKDF2' },
      false,
      ['deriveBits'],
    )

    const derivedBits = await crypto.subtle.deriveBits(
      PBKDF2_PARAMS,
      passwordKey,
      256,
    )

    cachedKey = await crypto.subtle.importKey(
      'raw',
      derivedBits,
      { name: 'AES-GCM' },
      true, // 允许导出，用于生成指纹
      ['encrypt', 'decrypt'],
    )

    return cachedKey
  } catch (err) {
    throw new Error(
      `获取加密密钥失败: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
}

/**
 * 获取密钥指纹（用于 UI 显示，证明加密已启用）
 * @returns 密钥的 SHA-256 哈希前 16 位
 */
export async function getKeyFingerprint(): Promise<string> {
  try {
    const key = await getKey()
    const raw = await crypto.subtle.exportKey('raw', key)
    const hash = await sha256(new Uint8Array(raw))
    return hash.slice(0, 16)
  } catch (err) {
    console.error('获取密钥指纹失败:', err)
    return 'unknown'
  }
}

/**
 * 加密字符串
 * @param plaintext 明文
 * @param key 可选的 CryptoKey，默认使用 getKey() 获取
 * @returns 密文字节数组（格式：16 字节 IV + ciphertext）
 */
export async function encryptString(
  plaintext: string,
  key?: CryptoKey,
): Promise<Uint8Array> {
  try {
    const targetKey = key ?? (await getKey())
    const iv = crypto.getRandomValues(new Uint8Array(16))
    const encoded = new TextEncoder().encode(plaintext)

    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      targetKey,
      encoded,
    )

    // 拼接 IV + ciphertext
    const result = new Uint8Array(iv.length + ciphertext.byteLength)
    result.set(iv, 0)
    result.set(new Uint8Array(ciphertext), iv.length)
    return result
  } catch (err) {
    throw new Error(
      `加密失败: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
}

/**
 * 解密字符串
 * @param ciphertext 密文字节数组（格式：16 字节 IV + ciphertext）
 * @param key 可选的 CryptoKey，默认使用 getKey() 获取
 * @returns 明文字符串
 */
export async function decryptToString(
  ciphertext: Uint8Array,
  key?: CryptoKey,
): Promise<string> {
  try {
    if (ciphertext.length < 17) {
      throw new Error('密文长度不足（至少需要 17 字节：16 字节 IV + 1 字节数据）')
    }

    const targetKey = key ?? (await getKey())
    const iv = ciphertext.slice(0, 16)
    const data = ciphertext.slice(16)

    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      targetKey,
      data,
    )

    return new TextDecoder().decode(decrypted)
  } catch (err) {
    throw new Error(
      `解密失败: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
}

/**
 * 计算 SHA-256 哈希
 * @param data 输入数据（字符串或 Uint8Array）
 * @returns 十六进制哈希字符串（小写）
 */
export async function sha256(data: string | Uint8Array): Promise<string> {
  try {
    const encoded =
      typeof data === 'string' ? new TextEncoder().encode(data) : data

    const hashBuffer = await crypto.subtle.digest('SHA-256', encoded)
    return uint8ArrayToHex(new Uint8Array(hashBuffer))
  } catch (err) {
    throw new Error(
      `哈希计算失败: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
}

// ============================================================
// 工具函数
// ============================================================

/**
 * Uint8Array 转十六进制字符串
 */
function uint8ArrayToHex(arr: Uint8Array): string {
  return Array.from(arr)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}
