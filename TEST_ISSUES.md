# 全量测试问题清单

规则：新记录追加在顶部 | 修复后标记 [已修复] | 按优先级排序

---

## P0 — 严重 Bug（核心功能完全失效）

- [ ] **P0-1: saveNote 调用签名不匹配**
  - 文件: `src/components/NoteEditor.tsx` ~306 行
  - 问题: `saveNote(noteId, content, title)` 传 3 个 string，但 note-engine 签名是 `saveNote(note: Note, content: string)`
  - 影响: 笔记无法保存

- [ ] **P0-2: createNote 调用签名不匹配**
  - 文件: `src/pages/HomePage.tsx` ~259 行
  - 问题: `createNote(volumeId, bookId, name)` 参数顺序/含义与 note-engine 签名 `createNote(volumeId, title, content?)` 不匹配
  - 影响: 创建笔记标题错误

- [ ] **P0-3: builtin-notes 内容未写入文件**
  - 文件: `src/engine/builtin-notes.ts`
  - 问题: `createNote()` 只写数据库元数据，未调用 `saveNote()` 写入 .note 文件
  - 影响: 内置示例笔记全部显示为空

- [ ] **P0-4: templates 表缺少 content 列**
  - 文件: `src/engine/database.ts` ~83 行
  - 问题: 建表 SQL 无 content 列，但 createTemplate/updateTemplate 写入 content
  - 影响: 模板功能完全失效

- [ ] **P0-5: volumes 表缺少 note_count 列**
  - 文件: `src/engine/database.ts` ~46 行 + runMigrations
  - 问题: 建表 SQL 无 note_count 列，runMigrations 也未迁移
  - 影响: listVolumes 查询报错

- [ ] **P0-6: image-engine 函数签名与 NoteEditor 调用不匹配**
  - 文件: `src/components/NoteEditor.tsx` ~97-120 行 vs `src/engine/image-engine.ts`
  - 问题: compressImage 参数类型不对、saveImage 参数数量/顺序不对、enqueueImageSync 不存在、getUnsyncedImageCount 缺参数
  - 影响: 图片粘贴/拖拽功能完全失效

---

## P1 — 重要 Bug（功能异常或数据不一致）

- [ ] **P1-1: export-engine 导出加密笔记未解密**
  - 文件: `src/engine/export-engine.tsx` ~20 行
  - 问题: 直接用 TextDecoder 读取文件，未检查 [ENC] 前缀
  - 影响: 加密笔记导出为乱码

- [ ] **P1-2: export-engine ZIP 导出查询 images 表使用了不存在的列**
  - 文件: `src/engine/export-engine.tsx` ~283 行
  - 问题: 查询 `webp_name` 列，但 images 表无此列
  - 影响: ZIP 导出图片打包报错

- [ ] **P1-3: sync-engine generateManifest 路径约定与实际不一致**
  - 文件: `src/engine/sync-engine.ts` ~290 行
  - 问题: 注释说 `books/{bookId}/volumes/...` 但实际是 `Books/{bookId}/Notes/...`
  - 影响: 同步功能路径错误

- [ ] **P1-4: TrashPage 引用不存在的 originalPath 属性**
  - 文件: `src/pages/TrashPage.tsx` ~101 行
  - 问题: TrashItem 接口无 originalPath
  - 影响: TypeScript 编译错误

- [ ] **P1-5: db.run 后未调用 saveDB 持久化**
  - 文件: `src/engine/note-engine.ts` 全文
  - 问题: 所有数据库修改操作只修改内存，未写回文件
  - 影响: 刷新页面后数据丢失

- [ ] **P1-6: builtin-notes createNote 返回值未使用**
  - 文件: `src/engine/builtin-notes.ts`
  - 问题: 与 P0-3 相同，需要调用 saveNote
  - 影响: 内置笔记内容丢失

---

## P2 — 中等问题（功能缺失或 UI 问题）

- [ ] **P2-1: 云盘同步设置纯内存状态**
  - 文件: `src/components/modals/SettingsModal.tsx` ~233-334 行
  - 问题: 服务器列表用 useState，刷新后丢失；"移除"按钮无 onClick
  - 影响: 云盘配置无法保存

- [ ] **P2-2: 图片设置不生效**
  - 文件: `src/components/modals/SettingsModal.tsx` ~395-437 行
  - 问题: 滑块/开关只改 state，未保存；"保存原图"开关无 onClick
  - 影响: 图片压缩设置形同虚设

- [ ] **P2-3: 数据库管理页面纯静态文本**
  - 文件: `src/components/modals/SettingsModal.tsx` ~662-670 行
  - 问题: 只显示"数据库状态正常"，无任何操作按钮
  - 影响: 数据库管理页面是空壳

- [ ] **P2-4: "从云盘恢复已有数据"链接无功能**
  - 文件: `src/pages/HomePage.tsx` ~437-439 行
  - 问题: 有 cursor-pointer 但无 onClick
  - 影响: 点击无反应

- [ ] **P2-5: builtin-notes 描述了不存在的功能**
  - 文件: `src/engine/builtin-notes.ts` ~67-89 行
  - 问题: 描述 WebDAV/FTP/S3 配置，但 UI 只有空壳
  - 影响: 误导用户

- [ ] **P2-6: 加密开关无 UI 入口**
  - 文件: `src/engine/note-engine.ts` ~15-25 行
  - 问题: setEncryptionEnabled 从未被 UI 调用
  - 影响: 加密永远默认关闭

---

## P3 — 低优先级（代码质量）

- [ ] **P3-1: encryption.ts 硬编码固定密钥**（设计决策，非 bug）
- [ ] **P3-2: export-engine 使用 renderToString**（浏览器环境兼容性风险）
- [ ] **P3-3: doInit/handlePickerReady 代码重复**（维护困难）
- [ ] **P3-4: TrashPage permanent prop 未使用**（UI 无区分）
- [ ] **P3-5: SettingsModal 导入了未使用的 sha256**（无用导入）
- [ ] **P3-6: sync-engine 路径约定注释与实际不一致**（与 P1-3 相同）
