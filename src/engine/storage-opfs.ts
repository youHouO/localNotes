/**
 * 基于 OPFS 的降级存储层实现
 * 当浏览器不支持 File System Access API 时使用
 * 数据存储在浏览器沙箱中，清除浏览器数据会丢失
 */

let rootDirHandle: FileSystemDirectoryHandle | null = null

/**
 * 初始化存储：直接获取 OPFS 根目录，无需用户交互
 */
export async function initStorage(): Promise<void> {
  if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) {
    throw new Error('当前浏览器不支持文件系统存储')
  }
  rootDirHandle = await navigator.storage.getDirectory()
}

/**
 * 逐级获取目录 handle
 */
async function getDirectoryHandle(
  path: string,
  create = false,
): Promise<FileSystemDirectoryHandle> {
  if (!rootDirHandle) throw new Error('存储未初始化')

  const parts = path.split('/').filter(Boolean)
  let current = rootDirHandle

  for (const part of parts) {
    current = await current.getDirectoryHandle(part, { create })
  }

  return current
}

/**
 * 逐级获取文件 handle
 */
async function getFileHandle(
  path: string,
  create = false,
): Promise<FileSystemFileHandle> {
  if (!rootDirHandle) throw new Error('存储未初始化')

  const parts = path.split('/').filter(Boolean)
  const fileName = parts.pop()!
  const dirHandle = parts.length > 0
    ? await getDirectoryHandle(parts.join('/'), create)
    : rootDirHandle

  return dirHandle.getFileHandle(fileName, { create })
}

/**
 * 读取文件内容，文件不存在时返回 null
 */
export async function readFile(path: string): Promise<Uint8Array | null> {
  try {
    const fileHandle = await getFileHandle(path)
    const file = await fileHandle.getFile()
    const buffer = await file.arrayBuffer()
    return new Uint8Array(buffer)
  } catch (err) {
    if (err instanceof Error && err.name === 'NotFoundError') return null
    throw err
  }
}

/**
 * 写入文件，自动创建父目录
 */
export async function writeFile(path: string, data: Uint8Array | string): Promise<void> {
  const encoder = new TextEncoder()
  const bytes = typeof data === 'string' ? encoder.encode(data) : data

  const fileHandle = await getFileHandle(path, true)
  const writable = await fileHandle.createWritable()
  await writable.write(bytes)
  await writable.close()
}

/**
 * 检查文件是否存在
 */
export async function fileExists(path: string): Promise<boolean> {
  try {
    await getFileHandle(path)
    return true
  } catch (err) {
    if (err instanceof Error && err.name === 'NotFoundError') return false
    throw err
  }
}

/**
 * 删除文件
 */
export async function deleteFile(path: string): Promise<void> {
  const parts = path.split('/').filter(Boolean)
  const fileName = parts.pop()!
  const dirHandle = parts.length > 0
    ? await getDirectoryHandle(parts.join('/'))
    : rootDirHandle!

  await dirHandle.removeEntry(fileName)
}

/**
 * 递归删除目录
 */
export async function deleteDirectory(path: string): Promise<void> {
  const parts = path.split('/').filter(Boolean)
  const dirName = parts.pop()!
  const parentHandle = parts.length > 0
    ? await getDirectoryHandle(parts.join('/'))
    : rootDirHandle!

  await parentHandle.removeEntry(dirName, { recursive: true })
}

/**
 * 列出目录内容
 */
export async function listDirectory(path: string): Promise<string[]> {
  const dirHandle = path ? await getDirectoryHandle(path) : rootDirHandle!
  const names: string[] = []

  // @ts-expect-error values() 在标准类型中未定义，但浏览器已支持
  for await (const entry of dirHandle.values()) {
    names.push(entry.name)
  }

  return names
}

/**
 * 创建目录（逐级）
 */
export async function createDirectory(path: string): Promise<void> {
  await getDirectoryHandle(path, true)
}

/**
 * 移动文件：读源 → 写目标 → 删源
 */
export async function moveFile(sourcePath: string, destPath: string): Promise<void> {
  const data = await readFile(sourcePath)
  if (data === null) throw new Error(`源文件不存在: ${sourcePath}`)
  await writeFile(destPath, data)
  await deleteFile(sourcePath)
}

/**
 * 同步检查存储是否已就绪
 */
export function isStorageReady(): boolean {
  return rootDirHandle !== null
}
