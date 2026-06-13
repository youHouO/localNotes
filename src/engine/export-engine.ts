/**
 * 导出引擎 - 数据导出功能
 *
 * 支持：
 * - 单笔记导出：明文 Markdown / PDF（浏览器打印）
 * - 单卷导出：ZIP（含笔记和图片）
 * - 单书导出：ZIP（含所有卷和笔记）
 * - 全量导出：ZIP（所有书）
 */

import JSZip from 'jszip'
import { readFile, listDirectory } from './storage'
import { decryptToString } from './encryption'
import { getDB } from './database'

/**
 * 导出单篇笔记为明文 Markdown 字符串
 */
export async function exportNoteAsMarkdown(noteId: string): Promise<{ title: string; content: string }> {
  try {
    const db = getDB()
    const results = db.exec('SELECT * FROM notes WHERE id = ?', [noteId])
    if (!results.length || !results[0].values.length) {
      throw new Error(`笔记不存在: ${noteId}`)
    }

    const cols = results[0].columns
    const row = results[0].values[0]
    const r: Record<string, unknown> = {}
    cols.forEach((c, i) => { r[c] = row[i] })

    const bookId = r.book_id as string
    const title = r.title as string

    // 读取加密文件并解密
    const encrypted = await readFile(`Books/${bookId}/Notes/${noteId}.note`)
    const content = await decryptToString(encrypted)

    return { title, content }
  } catch (err) {
    throw new Error(`导出 Markdown 失败: ${err instanceof Error ? err.message : String(err)}`)
  }
}

/**
 * 导出单篇笔记为 Markdown 文件下载
 */
export async function downloadNoteAsMarkdown(noteId: string): Promise<void> {
  const { title, content } = await exportNoteAsMarkdown(noteId)
  downloadFile(`${title}.md`, content, 'text/markdown;charset=utf-8')
}

/**
 * 导出单篇笔记为 PDF
 * 打开新窗口 → 渲染 Markdown → 浏览器打印
 */
export function exportNoteAsPDF(noteId: string): void {
  // 打开打印窗口（简化的 PDF 导出）
  // 实际使用时会传递内容到打印窗口
  const printWindow = window.open('', '_blank', 'width=800,height=600')
  if (!printWindow) {
    alert('请允许弹出窗口以导出 PDF')
    return
  }

  exportNoteAsMarkdown(noteId).then(({ title, content }) => {
    // 打印窗口可能在异步期间被用户关闭
    if (printWindow.closed) return

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:system-ui,sans-serif;max-width:800px;margin:40px auto;padding:0 20px;line-height:1.8;font-size:14px;}
h1{font-size:24px}h2{font-size:20px}pre{background:#f4f4f4;padding:12px;border-radius:4px;overflow-x:auto}
img{max-width:100%}code{background:#f4f4f4;padding:2px 6px;border-radius:3px}
blockquote{border-left:3px solid #ddd;margin:0;padding-left:16px;color:#666}</style></head>
<body><h1>${title}</h1><div id="content"></div></body></html>`

    printWindow.document.write(html)
    printWindow.document.close()

    // 使用简单的 Markdown 渲染（换行→段落, **→加粗等基本转换）
    setTimeout(() => {
      if (printWindow.closed) return
      const contentEl = printWindow.document.getElementById('content')
      if (contentEl) {
        contentEl.innerHTML = renderSimpleMarkdown(content)
      }
      printWindow.print()
    }, 500)
  }).catch(err => {
    if (printWindow.closed) return
    printWindow.document.write(`<p>导出失败: ${err instanceof Error ? err.message : String(err)}</p>`)
    printWindow.document.close()
  })
}

/** 简易 Markdown → HTML 渲染 */
function renderSimpleMarkdown(md: string): string {
  return md
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/^(.+)$/gm, (m) => m.startsWith('<') ? m : `<p>${m}</p>`)
}

/**
 * 导出单卷为 ZIP
 */
export async function exportVolumeAsZip(volumeId: string): Promise<Blob> {
  const zip = new JSZip()
  const db = getDB()

  // 获取卷信息
  const volResults = db.exec('SELECT id, book_id, name FROM volumes WHERE id = ?', [volumeId])
  if (!volResults.length || !volResults[0].values.length) {
    throw new Error(`卷不存在: ${volumeId}`)
  }
  const volCols = volResults[0].columns
  const volRow = volResults[0].values[0]
  const volName = volRow[volCols.indexOf('name')] as string

  // 获取卷下所有笔记
  const noteResults = db.exec(
    'SELECT id, book_id FROM notes WHERE volume_id = ? AND updated_at > 0',
    [volumeId]
  )

  if (noteResults.length) {
    const folder = zip.folder(volName)!
    let firstBookId = ''
    for (const row of noteResults[0].values) {
      const noteId = row[0] as string
      const bookId = row[1] as string
      if (!firstBookId) firstBookId = bookId
      try {
        const encrypted = await readFile(`Books/${bookId}/Notes/${noteId}.note`)
        const content = await decryptToString(encrypted)
        const titleResult = db.exec('SELECT title FROM notes WHERE id = ?', [noteId])
        const title = titleResult.length ? (titleResult[0].values[0][0] as string) : noteId
        folder.file(`${title}.md`, content)
      } catch {
        // 跳过读取失败的笔记
      }
    }

    // 复制图片到 images 子目录
    if (firstBookId) {
      try {
        const imageDir = `Books/${firstBookId}/images`
        const imageFiles = await listDirectory(imageDir)
        const imgFolder = folder.folder('images')!
        for (const imgFile of imageFiles) {
          try {
            const imgData = await readFile(`${imageDir}/${imgFile}`)
            imgFolder.file(imgFile, imgData)
          } catch { /* 跳过读取失败的图片 */ }
        }
      } catch { /* 无图片目录时跳过 */ }
    }
  }

  return zip.generateAsync({ type: 'blob' })
}

/**
 * 导出单书为 ZIP
 */
export async function exportBookAsZip(bookId: string): Promise<Blob> {
  const zip = new JSZip()
  const db = getDB()

  const bookResults = db.exec('SELECT name FROM books WHERE id = ?', [bookId])
  if (!bookResults.length || !bookResults[0].values.length) {
    throw new Error(`书不存在: ${bookId}`)
  }
  const bookName = bookResults[0].values[0][0] as string
  const bookFolder = zip.folder(bookName)!

  // 获取书下所有卷
  const volResults = db.exec('SELECT id, name FROM volumes WHERE book_id = ? AND updated_at > 0', [bookId])
  if (volResults.length) {
    for (const volRow of volResults[0].values) {
      const volId = volRow[0] as string
      const volName = volRow[1] as string
      const volFolder = bookFolder.folder(volName)!

      const noteResults = db.exec(
        'SELECT id FROM notes WHERE volume_id = ? AND updated_at > 0',
        [volId]
      )
      if (noteResults.length) {
        for (const noteRow of noteResults[0].values) {
          const noteId = noteRow[0] as string
          try {
            const encrypted = await readFile(`Books/${bookId}/Notes/${noteId}.note`)
            const content = await decryptToString(encrypted)
            const titleResult = db.exec('SELECT title FROM notes WHERE id = ?', [noteId])
            const title = titleResult.length ? (titleResult[0].values[0][0] as string) : noteId
            volFolder.file(`${title}.md`, content)
          } catch (err) { console.warn('导出跳过文件:', err); /* skip */ }
        }
      }
    }
  }

  // 复制整本书的图片
  try {
    const imageDir = `Books/${bookId}/images`
    const imageFiles = await listDirectory(imageDir)
    const imgFolder = bookFolder.folder('images')!
    for (const imgFile of imageFiles) {
      try {
        const imgData = await readFile(`${imageDir}/${imgFile}`)
        imgFolder.file(imgFile, imgData)
      } catch { /* 跳过读取失败的图片 */ }
    }
  } catch { /* 无图片目录时跳过 */ }

  return zip.generateAsync({ type: 'blob' })
}

/**
 * 全量导出所有数据为 ZIP
 */
export async function exportAllAsZip(): Promise<Blob> {
  const zip = new JSZip()
  const db = getDB()

  const bookResults = db.exec('SELECT id, name FROM books WHERE updated_at > 0')
  if (!bookResults.length) {
    throw new Error('没有可导出的数据')
  }

  for (const bookRow of bookResults[0].values) {
    const bookId = bookRow[0] as string
    const bookName = bookRow[1] as string
    const bookFolder = zip.folder(bookName)!

    // 导出每本书的卷和笔记（复用单书导出逻辑，简化为直接遍历）
    const volResults = db.exec(
      'SELECT id, name FROM volumes WHERE book_id = ? AND updated_at > 0',
      [bookId]
    )
    if (volResults.length) {
      for (const volRow of volResults[0].values) {
        const volId = volRow[0] as string
        const volName = volRow[1] as string
        const volFolder = bookFolder.folder(volName)!

        const noteResults = db.exec(
          'SELECT id FROM notes WHERE volume_id = ? AND updated_at > 0',
          [volId]
        )
        if (noteResults.length) {
          for (const noteRow of noteResults[0].values) {
            const noteId = noteRow[0] as string
            try {
              const encrypted = await readFile(`Books/${bookId}/Notes/${noteId}.note`)
              const content = await decryptToString(encrypted)
              const titleResult = db.exec('SELECT title FROM notes WHERE id = ?', [noteId])
              const title = titleResult.length ? (titleResult[0].values[0][0] as string) : noteId
              volFolder.file(`${title}.md`, content)
            } catch (err) { console.warn('导出跳过文件:', err); /* skip */ }
          }
        }
      }
    }

    // 复制整本书的图片
    try {
      const imageDir = `Books/${bookId}/images`
      const imageFiles = await listDirectory(imageDir)
      const imgFolder = bookFolder.folder('images')!
      for (const imgFile of imageFiles) {
        try {
          const imgData = await readFile(`${imageDir}/${imgFile}`)
          imgFolder.file(imgFile, imgData)
        } catch { /* 跳过读取失败的图片 */ }
      }
    } catch { /* 无图片目录时跳过 */ }
  }

  return zip.generateAsync({ type: 'blob' })
}

/**
 * 触发浏览器下载
 */
function downloadFile(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  // 延迟释放 URL，确保下载已开始
  setTimeout(() => {
    URL.revokeObjectURL(url)
    a.remove()
  }, 1000)
}

/**
 * 触发 ZIP Blob 下载
 */
export function downloadZip(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  // 延迟释放 URL，确保下载已开始
  setTimeout(() => {
    URL.revokeObjectURL(url)
    a.remove()
  }, 1000)
}
