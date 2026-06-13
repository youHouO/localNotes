/**
 * 内置入门笔记
 *
 * 首次启动时自动创建，用于介绍和说明 LocalNotes 的功能。
 * 仅在没有任何书（listBooks() 返回空）时触发。
 */

import { createBook, createVolume, createNote, listBooks } from './note-engine'

const BUILTIN_NOTES: Array<{ title: string; content: string }> = [
  {
    title: '欢迎使用 LocalNotes',
    content: `# 欢迎使用 LocalNotes 🎉

LocalNotes 是一款**本地优先**的个人笔记软件，所有数据存储在你的设备上，不依赖任何云端服务。

## 核心理念

- **本地优先**：数据保存在浏览器内置的加密文件系统中（OPFS），无需注册账号
- **离线可用**：不联网也能正常使用，你的笔记始终在本地
- **快速可靠**：基于 SQLite 的全文搜索索引，查找内容毫秒级响应

## 开始使用

左侧边栏展示了你的所有书（Book）。每本书包含多个**卷（Volume）**，每个卷下可以创建多篇**笔记（Note）**。

> 💡 试试看：点击左侧的 "新建书" 按钮，创建你的第一本书吧！

## 数据安全

所有笔记文件在保存时都会使用 **AES-256-CTR** 加密，确保即使文件被复制出去也无法被直接读取。`,
  },
  {
    title: '创建与组织笔记',
    content: `# 创建与组织笔记

LocalNotes 使用 **书 → 卷 → 笔记** 三级结构来组织你的内容。

## 📚 书（Book）

书是最高层级的组织单位。你可以为不同用途创建不同的书，例如：
- "工作笔记"
- "学习笔记"
- "个人日记"

## 📂 卷（Volume）

每本书下可以创建多个卷，用来进一步分类：
- "会议记录"
- "项目文档"
- "读书笔记"

## 📝 笔记（Note）

每篇笔记使用 **Markdown** 格式编写，支持丰富的排版和格式化。

### 创建笔记
1. 在左侧选择一本书
2. 点击右上角的 **+ 新建卷** 或选择一个已有卷
3. 在卷下方点击 **+ 新建笔记**

### 常用操作
- **重命名**：右键点击书/卷/笔记
- **删除**：删除后进入回收站，30 天内可恢复
- **排序**：拖拽卷可调整顺序

> 💡 可以在左侧边栏底部找到**回收站**和**模板管理**入口。`,
  },
  {
    title: 'Markdown 编辑功能',
    content: `# Markdown 编辑功能

LocalNotes 内置了专业的 Markdown 编辑器，让你专注于写作。

## ✨ 编辑体验

- **语法高亮**：标题、列表、代码块等自动着色
- **实时预览**：右侧面板即时渲染 Markdown 效果
- **三种视图**：纯编辑 / 分屏 / 纯预览，按需切换
- **自动保存**：停止输入 500ms 后自动保存，不怕丢失

## 📋 支持的语法

| 语法 | 效果 |
|------|------|
| \`# 标题\` | 一级标题 |
| \`**加粗**\` | **加粗文字** |
| \`*斜体*\` | *斜体文字* |
| \`- 列表\` | 无序列表 |
| \`1. 编号\` | 有序列表 |
| \`> 引用\` | 引用块 |
| \`\`\`代码块\`\`\` | 代码块 |
| \`[链接](url)\` | 超链接 |

## 🖼️ 插入图片

支持粘贴或拖拽图片到编辑器，图片会自动压缩（WebP 格式）并加密存储。

## 📊 字数统计

编辑器底部状态栏实时显示字数，帮你把控写作进度。`,
  },
  {
    title: '云同步与备份',
    content: `# 云同步与备份

LocalNotes 支持通过 **WebDAV** 协议将数据同步到云端，实现多设备访问和数据备份。

## 🔗 支持的云服务

任何支持 WebDAV 的网盘都可以使用：

- **自建服务**：Nextcloud、ownCloud、Seafile
- **商业网盘**：坚果云、TeraCloud、Koofr
- **NAS**：群晖、威联通等

## ⚙️ 配置方法

1. 进入 **设置 → 云盘管理**
2. 点击 **添加云盘**
3. 填写 WebDAV 地址、用户名和密码
4. 点击 **测试连接** 确认配置正确

## 🔄 同步机制

- **手动同步**：在首页顶部点击同步按钮
- **自动同步**：可设置定时自动上传/下载
- **增量同步**：只传输变更的文件，节省流量
- **冲突处理**：本地修改优先，自动备份远程版本

## 🛡️ 多网盘冗余

支持配置多个云盘，数据在多个位置都有备份，不怕单点故障。

> ⚠️ 同步到云端前请确认网盘的安全性。云端存储的是**加密后的数据**，但传输过程中请确保使用 HTTPS。`,
  },
  {
    title: '隐私与安全',
    content: `# 隐私与安全

保护你的数据隐私是 LocalNotes 设计的首要原则。

## 🔒 加密机制

- 所有笔记文件和图片使用 **AES-256-CTR** 加密存储
- 每个文件使用独立的随机初始化向量（IV）
- 文件格式：\`[16字节IV][密文数据]\`

## 🏠 数据归属

- **数据完全归你所有**：笔记保存在你设备的浏览器私有文件系统中
- **无后台服务器**：LocalNotes 是一个纯前端应用，不向任何服务器发送数据
- **无需注册账号**：没有用户系统，没有遥测追踪
- **离线即用**：首次加载后即可离线使用

## 🌐 网络隐私

- 除了你主动配置的 WebDAV 同步外，应用不会发起任何外部网络请求
- 同步使用 HTTPS 加密传输
- 没有第三方分析/统计 SDK

## ⚠️ 安全提示

当前版本使用固定密钥加密，适合一般隐私保护场景。如果你需要更强的安全性：

- 请关注后续版本的用户主密码功能
- 不要在不安全的网络环境下使用 HTTP 协议的 WebDAV
- 定期备份你的数据

## 🗑️ 数据清理

删除笔记后进入回收站，30 天后自动清理。你也可以手动永久删除或恢复。`,
  },
]

/**
 * 创建内置入门笔记
 *
 * 仅在首次启动（无任何书）时由 HomePage 调用。
 * 内置修复容错：每一步失败都不影响后续步骤。
 */
export async function createBuiltinNotes(): Promise<void> {
  // 防止重复创建
  const existingBooks = listBooks()
  if (existingBooks.length > 0) {
    return
  }

  console.log('[BuiltinNotes] 检测到首次启动，创建入门笔记...')

  // 创建书
  let bookId: string
  try {
    const book = await createBook('欢迎使用 LocalNotes')
    bookId = book.id
  } catch (err) {
    console.error('[BuiltinNotes] 创建书失败:', err)
    return
  }

  // 创建卷
  let volumeId: string
  try {
    const volume = await createVolume(bookId, '快速入门')
    volumeId = volume.id
  } catch (err) {
    console.error('[BuiltinNotes] 创建卷失败:', err)
    return
  }

  // 逐篇创建笔记
  for (const note of BUILTIN_NOTES) {
    try {
      await createNote(volumeId, bookId, note.title, note.content)
    } catch (err) {
      console.error(`[BuiltinNotes] 创建笔记 "${note.title}" 失败:`, err)
      // 继续创建后续笔记，不因单篇失败而中断
    }
  }

  console.log('[BuiltinNotes] 入门笔记创建完成')
}
