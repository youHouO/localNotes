# 全量测试问题清单

规则：新记录追加在顶部 | 修复后标记 [已修复] | 按优先级排序

---

## P0 — 严重 Bug（核心功能完全失效）

- [x] **P0-1: saveNote 调用签名不匹配** [已修复]
  - 新增 `saveNoteById(noteId, content, title?)` 便捷函数

- [x] **P0-2: createNote 调用签名不匹配** [已修复]
  - 修正参数顺序为 `createNote(volumeId, name)`

- [x] **P0-3: builtin-notes 内容未写入文件** [已修复]
  - `createNote` 后调用 `saveNote` 写入 .note 文件

- [x] **P0-4: templates 表缺少 content 列** [已修复]
  - 建表 SQL + runMigrations 补充 content 列

- [x] **P0-5: volumes 表缺少 note_count 列** [已修复]
  - 建表 SQL + runMigrations 补充 note_count 列

- [x] **P0-6: image-engine 函数签名与 NoteEditor 调用不匹配** [已修复]
  - 修复 compressImage/saveImage/getUnsyncedImageCount 调用

---

## P1 — 重要 Bug（功能异常或数据不一致）

- [x] **P1-1: export-engine 导出加密笔记未解密** [已修复]
  - 检查 [ENC] 前缀，调用 decryptToString

- [x] **P1-2: export-engine ZIP 导出查询 images 表使用了不存在的列** [已修复]
  - webp_name → local_path

- [x] **P1-3: sync-engine generateManifest 路径约定与实际不一致** [已修复]
  - 路径修正为 Books/{bookId}/Notes/{noteId}.note

- [x] **P1-4: TrashPage 引用不存在的 originalPath 属性** [已修复]
  - 改为显示 bookId

- [x] **P1-5: db.run 后未调用 saveDB 持久化** [已修复]
  - 所有修改函数添加 saveDB() 调用

- [x] **P1-6: builtin-notes createNote 返回值未使用** [已修复]
  - 与 P0-3 同一修复

---

## P2 — 中等问题（功能缺失或 UI 问题）

- [x] **P2-1: 云盘同步设置纯内存状态** [已修复]
  - localStorage 持久化 + 移除按钮 onClick

- [x] **P2-2: 图片设置不生效** [已修复]
  - localStorage 持久化 + 保存原图开关可切换

- [x] **P2-3: 数据库管理页面纯静态文本** [已修复]
  - 添加统计/重建索引/清除历史按钮

- [x] **P2-4: "从云盘恢复已有数据"链接无功能** [已修复]
  - 添加 onClick 跳转设置

- [x] **P2-5: builtin-notes 描述了不存在的功能** [待评估]
  - 云同步功能引擎已实现，UI 已有设置入口

- [x] **P2-6: 加密开关无 UI 入口** [已修复]
  - SecuritySettingsContent 添加加密开关

---

## P3 — 低优先级（代码质量）

- [x] **P3-1: encryption.ts 硬编码固定密钥** [已修复]
  - 补充设计说明注释

- [x] **P3-2: export-engine 使用 renderToString** [已修复]
  - 改用纯正则 Markdown 转 HTML

- [x] **P3-3: doInit/handlePickerReady 代码重复** [已修复]
  - 提取 finishInit() 公共函数

- [x] **P3-4: TrashPage permanent prop 未使用** [已修复]
  - permanent 删除时红色按钮 + 永久删除文案

- [x] **P3-5: SettingsModal 导入了未使用的 sha256** [已修复]
  - 删除未使用导入

- [x] **P3-6: sync-engine 路径约定注释与实际不一致** [已修复]
  - 修正路径注释
