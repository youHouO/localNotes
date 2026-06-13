/**
 * 加密模块 - AES-256-CTR 加解密
 *
 * 安全模型说明：
 * - 采用固定全局密钥，硬编码在代码中
 * - 加密目标：确保本地和云端文件均为非明文格式
 * - 不防身边人攻击（任何人拿到.note文件+解密工具即可解密）
 * - 架构已预留扩展能力，未来可增加可选用户主密码端到端加密
 *
 * 文件格式：[16字节IV][密文]
 * 密钥来源：固定字符串 → SHA-256 → 32字节密钥
 */

const ENCRYPTION_KEY_STRING = 'localnotes-aes-256-ctr-fixed-key-v1'

/**
 * 【高风险】固定加密密钥
 * 通过 SHA-256 将固定字符串派生为 256 位（32 字节）密钥
 * 所有用户、所有设备使用完全相同的密钥
 */
let cachedKey: CryptoKey | null = null

/**
 * 获取或生成 AES-256-CTR 密钥（CryptoKey 对象）
 * 首次调用时通过 SHA-256 派生，之后使用缓存
 */
async function getKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey

  try {
    // 步骤1：将固定字符串编码为字节数组
    const keyMaterial = new TextEncoder().encode(ENCRYPTION_KEY_STRING)

    // 步骤2：SHA-256 哈希 → 32 字节（256 位）
    const hashBuffer = await crypto.subtle.digest('SHA-256', keyMaterial)

    // 步骤3：导入为 AES-CTR 密钥
    cachedKey = await crypto.subtle.importKey(
      'raw',
      hashBuffer,
      { name: 'AES-CTR' },
      false, // 不可导出（架构预留：未来可导出供解密工具使用）
      ['encrypt', 'decrypt']
    )

    return cachedKey
  } catch (err) {
    throw new Error(`密钥派生失败（当前环境可能不支持 Web Crypto API）: ${err instanceof Error ? err.message : String(err)}`)
  }
}

/**
 * 生成密码学安全的 16 字节随机 IV
 * 使用 crypto.getRandomValues
 */
function generateIV(): Uint8Array {
  const iv = new Uint8Array(16)
  crypto.getRandomValues(iv)
  return iv
}

/**
 * 加密明文数据
 * @param plaintext - 明文数据（字符串或 Uint8Array）
 * @returns [16字节IV, 密文] 拼接的 Uint8Array
 */
export async function encrypt(plaintext: string | Uint8Array): Promise<Uint8Array> {
  try {
    const key = await getKey()
    const iv = generateIV()

    // 将输入统一为 Uint8Array
    const data = typeof plaintext === 'string'
      ? new TextEncoder().encode(plaintext)
      : plaintext

    // AES-256-CTR 加密
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-CTR', counter: iv, length: 128 },
      key,
      data
    )

    // 拼接：[IV (16字节)] [密文]
    const result = new Uint8Array(iv.length + ciphertext.byteLength)
    result.set(iv, 0)
    result.set(new Uint8Array(ciphertext), iv.length)

    return result
  } catch (error) {
    throw new Error(`加密失败: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * 解密密文数据
 * @param encryptedData - [16字节IV, 密文] 拼接的数据
 * @returns 解密后的明文 Uint8Array
 */
export async function decrypt(encryptedData: Uint8Array): Promise<Uint8Array> {
  try {
    if (encryptedData.length < 16) {
      throw new Error('密文数据格式错误：长度不足，无法提取 IV')
    }

    const key = await getKey()

    // 提取前 16 字节作为 IV
    const iv = encryptedData.slice(0, 16)
    // 剩余部分为密文
    const ciphertext = encryptedData.slice(16)

    // AES-256-CTR 解密
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-CTR', counter: iv, length: 128 },
      key,
      ciphertext
    )

    return new Uint8Array(plaintext)
  } catch (error) {
    throw new Error(`解密失败: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * 解密为字符串（便捷方法，用于 .note 文本文件）
 * @param encryptedData - [16字节IV, 密文] 拼接的数据
 * @returns 解密后的明文字符串
 */
export async function decryptToString(encryptedData: Uint8Array): Promise<string> {
  const plaintext = await decrypt(encryptedData)
  return new TextDecoder().decode(plaintext)
}

/**
 * 加密字符串（便捷方法，用于 .note 文本文件）
 * @param plaintext - 明文字符串
 * @returns [16字节IV, 密文] 拼接的 Uint8Array
 */
export async function encryptString(plaintext: string): Promise<Uint8Array> {
  return encrypt(plaintext)
}

/**
 * 计算数据的 SHA-256 哈希（用于明文哈希增量同步）
 * @param data - 明文数据
 * @returns 十六进制哈希字符串
 */
export async function sha256(data: Uint8Array | string): Promise<string> {
  try {
    const bytes = typeof data === 'string'
      ? new TextEncoder().encode(data)
      : data

    const hashBuffer = await crypto.subtle.digest('SHA-256', bytes)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
  } catch (err) {
    throw new Error(`SHA-256 哈希计算失败: ${err instanceof Error ? err.message : String(err)}`)
  }
}

/**
 * 暴露原始密钥字节（供独立解密工具使用）
 * 【高风险】此函数仅在独立解密工具中使用，主应用不调用
 */
export async function exportRawKey(): Promise<Uint8Array> {
  // 重新派生原始字节（不通过 exportKey，因为密钥标记为不可导出）
  const keyMaterial = new TextEncoder().encode(ENCRYPTION_KEY_STRING)
  const hashBuffer = await crypto.subtle.digest('SHA-256', keyMaterial)
  return new Uint8Array(hashBuffer)
}
