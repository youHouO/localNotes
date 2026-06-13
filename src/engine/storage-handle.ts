/**
 * Handle 持久化模块
 * 将 FileSystemDirectoryHandle 存储到 IndexedDB 中，用于跨会话保持权限
 */

const DB_NAME = 'localnotes-storage'
const STORE_NAME = 'handles'
const HANDLE_KEY = 'root-directory'

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

/**
 * 将 FileSystemDirectoryHandle 保存到 IndexedDB
 */
export async function saveHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await openDB()
  const tx = db.transaction(STORE_NAME, 'readwrite')
  tx.objectStore(STORE_NAME).put(handle, HANDLE_KEY)
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

/**
 * 从 IndexedDB 读取已保存的 FileSystemDirectoryHandle
 */
export async function loadHandle(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const db = await openDB()
    const tx = db.transaction(STORE_NAME, 'readonly')
    const handle = await new Promise<FileSystemDirectoryHandle | undefined>((resolve, reject) => {
      const req = tx.objectStore(STORE_NAME).get(HANDLE_KEY)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    return handle || null
  } catch {
    return null
  }
}

/**
 * 从 IndexedDB 删除已保存的 handle
 */
export async function removeHandle(): Promise<void> {
  const db = await openDB()
  const tx = db.transaction(STORE_NAME, 'readwrite')
  tx.objectStore(STORE_NAME).delete(HANDLE_KEY)
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

/**
 * 请求 handle 的读写权限
 * 先 queryPermission，若需要则 requestPermission
 */
export async function requestHandlePermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  try {
    const perm = await handle.queryPermission({ mode: 'readwrite' })
    if (perm === 'granted') return true
    if (perm === 'prompt') {
      const result = await handle.requestPermission({ mode: 'readwrite' })
      return result === 'granted'
    }
    return false
  } catch {
    return false
  }
}
