/**
 * 存储层统一入口
 * 自动检测浏览器能力，选择 File System Access API 或 OPFS 降级方案
 */

export type StorageBackend = 'fsaa' | 'opfs'

/** 当前选定的后端 */
let backend: StorageBackend = detectBackend()

/** 缓存已加载的后端模块 */
let cachedModule: typeof import('./storage-fsaa') | typeof import('./storage-opfs') | null = null

/**
 * 检测最佳存储后端
 */
function detectBackend(): StorageBackend {
  if (typeof window !== 'undefined' && 'showDirectoryPicker' in window) return 'fsaa'
  if (typeof navigator !== 'undefined' && navigator.storage?.getDirectory) return 'opfs'
  return 'opfs'
}

/**
 * 获取当前使用的后端名称（用于调试和日志）
 */
export function getStorageBackend(): StorageBackend {
  return backend
}

/**
 * 加载并缓存后端模块
 */
async function getModule() {
  if (!cachedModule) {
    if (backend === 'fsaa') {
      cachedModule = await import('./storage-fsaa')
    } else {
      cachedModule = await import('./storage-opfs')
    }
  }
  return cachedModule
}

/**
 * 初始化存储层
 */
export async function initStorage(): Promise<void> {
  const mod = await getModule()
  return mod.initStorage()
}

/**
 * 读取文件内容，文件不存在时返回 null
 */
export async function readFile(path: string): Promise<Uint8Array | null> {
  const mod = await getModule()
  return mod.readFile(path)
}

/**
 * 写入文件，自动创建父目录
 */
export async function writeFile(path: string, data: Uint8Array | string): Promise<void> {
  const mod = await getModule()
  return mod.writeFile(path, data)
}

/**
 * 检查文件是否存在
 */
export async function fileExists(path: string): Promise<boolean> {
  const mod = await getModule()
  return mod.fileExists(path)
}

/**
 * 删除文件
 */
export async function deleteFile(path: string): Promise<void> {
  const mod = await getModule()
  return mod.deleteFile(path)
}

/**
 * 递归删除目录
 */
export async function deleteDirectory(path: string): Promise<void> {
  const mod = await getModule()
  return mod.deleteDirectory(path)
}

/**
 * 列出目录内容
 */
export async function listDirectory(path: string): Promise<string[]> {
  const mod = await getModule()
  return mod.listDirectory(path)
}

/**
 * 创建目录（逐级）
 */
export async function createDirectory(path: string): Promise<void> {
  const mod = await getModule()
  return mod.createDirectory(path)
}

/**
 * 移动文件：读源 → 写目标 → 删源
 */
export async function moveFile(sourcePath: string, destPath: string): Promise<void> {
  const mod = await getModule()
  return mod.moveFile(sourcePath, destPath)
}

/**
 * 同步检查存储是否已就绪
 */
export function isStorageReady(): boolean {
  return cachedModule?.isStorageReady() ?? false
}
