/**
 * File System Access API 类型扩展
 * 补充 TypeScript 原生类型中缺失的 API 方法
 */

interface FileSystemDirectoryHandle {
  /** 异步迭代器，遍历目录内容 */
  [Symbol.asyncIterator](): AsyncIterableIterator<[string, FileSystemHandle]>
  /** 遍历目录条目 */
  values(): AsyncIterableIterator<FileSystemHandle>
}

interface FileSystemHandle {
  /** 查询权限 */
  queryPermission(descriptor: { mode: 'read' | 'readwrite' }): Promise<PermissionState>
  /** 请求权限 */
  requestPermission(descriptor: { mode: 'read' | 'readwrite' }): Promise<PermissionState>
}

interface FileSystemWritableFileStream extends WritableStream {
  write(data: BufferSource | Blob | string | { type: string; data?: BufferSource | Blob | string; position?: number; size?: number }): Promise<void>
  seek(position: number): Promise<void>
  truncate(size: number): Promise<void>
  close(): Promise<void>
}

interface Window {
  /** 请求用户选择目录 */
  showDirectoryPicker(options?: {
    id?: string
    mode?: 'read' | 'readwrite'
    startIn?: FileSystemHandle | 'desktop' | 'documents' | 'downloads' | 'music' | 'pictures' | 'videos'
  }): Promise<FileSystemDirectoryHandle>
}
