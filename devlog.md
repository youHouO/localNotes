# 开发日志
规则：新记录追加在顶部 | 每月归档旧记录为devlog.YYYYMM.md | 仅保留最近2周记录

## 2026-06-13（CodeMirror 修复 + UI 优化）

### CodeMirror 编辑器修复
- **根因**：`codemirror` 聚合包在 npm publish 时内联了 `@codemirror/state`，与 Vite 预构建的 `@codemirror/state` 产生多实例冲突
- **方案**：彻底移除 `codemirror` 聚合包，改用 `@codemirror/view`、`@codemirror/state`、`@codemirror/lang-markdown`、`@codemirror/commands`、`@codemirror/language`、`@codemirror/search`、`@codemirror/autocomplete`、`@codemirror/lint` 独立包，手动组装 basicSetup

### 搜索功能增强
- 搜索支持笔记内部文本内容（不再仅匹配标题）
- 搜索结果点击后自动滚动到匹配行并高亮显示
- 搜索结果显示匹配上下文片段

### UI 修复
- 右上角关闭按钮位置调整，不再与标题重叠
- 编辑按钮（撤销/重做/日期）移到工具栏最左侧
- Markdown 预览模式添加 `rehype-raw` 和 `remark-breaks` 插件
- 弹窗删除左侧"返回"按钮，保留右上角"x"关闭按钮

### Git 提交
```
fix(codemirror): 彻底修复 @codemirror/state 多实例冲突
fix(ui): 修复关闭按钮重叠/工具栏布局/预览模式/弹窗按钮
feat(search): 搜索支持全文内容+定位高亮
```

---

## 2026-06-13（Bug 修复总结 - 共修复 27 个 Bug）

### 今日修复总览

| 批次 | 修复 Bug | 数量 | 优先级 |
|------|----------|------|--------|
| 初始修复 | CodeMirror 多实例冲突、#1/#3/#6/#13 | 5 | P0/P1 |
| 批次1 | #2/#3/#15/#16/#17 | 5 | P0/P1 |
| 批次2 | #7/#8/#9/#10 | 4 | P1 |
| 批次3 | #26/#28/#31/#32/#33/#34/#35/#36 | 8 | P2 |
| 批次4 | #18/#22/#24/#25 | 4 | P2 |
| 批次5 | #29/#30/#37/#38/#39/#40 | 6 | P2/P3 |
| **总计** | | **27** | |

### 关键修复

**P0 修复（4个）**
- #1: note-engine.ts `db.exec` 链式访问添加安全检查
- #2: sync-engine.ts `new Uint8Array(content as ArrayBuffer)` 改为 `instanceof` 检查
- #3: sync-engine.ts 云端恢复哈希验证改为文件大小验证
- #4: NoteEditor.tsx CodeMirror 多实例冲突（动态导入缓存统一）

**P1 修复（8个）**
- #6: image-engine.ts setTimeout 中 async 添加 `.catch()`
- #7: SettingsModal 回收站子页面对接后端 API
- #8: SettingsModal 模板管理对接后端 API
- #9: SettingsModal 云盘表单添加用户名/密码输入框
- #10: export-engine.ts ZIP 导出添加图片复制逻辑
- #13: encryption.ts `getKey()`/`sha256()` 添加 try-catch
- #15: database.ts `initSQL()` 添加 try-catch
- #16: database.ts `saveDB()` 添加 try-catch
- #17: export-engine.ts PDF 导出添加 `printWindow.closed` 检查

**P2 修复（12个）**
- #18: SearchModal 添加 localStorage 搜索历史（最近10条）
- #22: NoteEditor 删除后显示 Toast "已移至回收站" + 返回上一级
- #24: SearchModal 默认搜索范围改为 "全部书"
- #25: SettingsModal 图片设置添加警告文字
- #26: sync-engine.ts `crypto.randomUUID()` 添加 try-catch + 回退
- #28: NoteEditor.tsx `initEditor()` 添加 `.catch()`
- #29: image-engine.ts 添加 `revokeImageUrl()` 防止内存泄漏
- #30: note-engine.ts `saveNote()` 添加 `.backup` 备份机制
- #31: export-engine.ts 硬编码列索引改为按列名取值
- #32: main.tsx `getElementById('root')!` 添加 null 检查
- #33: note-engine.ts 链式访问添加可选链保护
- #34: storage.ts `moveFile` 添加 `lastSlash > 0` 检查
- #35: image-engine.ts `listBookImages()` 添加 try-catch
- #36: export-engine.ts `exportNoteAsMarkdown()` 添加 try-catch
- #37: storage.ts 原子写入通过备份机制修复

**P3 修复（3个）**
- #38: note-engine.ts SQL 表名拼接添加白名单校验
- #39: export-engine.ts 延迟 1 秒释放 URL.createObjectURL
- #40: NoteEditor.tsx `setInterval` catch 添加 `console.warn`

### 剩余问题（下次处理）

| 优先级 | Bug | 说明 |
|--------|-----|------|
| P0 | #4 | 存储位置 OPFS vs 系统公共文档目录（架构决策） |
| P1 | #5 | 软删除机制：数据库负时间戳 vs 纯文件系统 `.trash` |
| P1 | #11 | 图片提前同步逻辑未实现 |
| P1 | #12 | 退出笔记时未同步图片提示 |
| P1 | #14 | `exportRawKey()` 无 try-catch |
| P2 | #19 | 按创建时间排序 |
| P2 | #20/#21 | 分屏模式 |
| P2 | #23 | 手动同步触发同步 |
| P3 | #41-#45 | 边界情况 |
| 环境 | #46/#47 | ESLint 配置损坏、无测试用例 |

### Git 提交记录
```
8464879 fix(batch5): 修复 P3 + 其他低优先级 Bug（6个）
e7b16bf fix(batch4): 修复 P2 需求不符 Bug（4个）
d1682c6 fix(batch3): 修复 P2 运行时异常（8个bug）
c38228f fix(batch2): 修复 P1 需求不符 Bug（回收站/模板/云盘表单/ZIP导出）
b8225d0 fix(batch1): 修复 P0 剩余 Bug + P1 运行时异常
e2ff7bd fix: 修复 4 个 P0/P1 Bug（遵循修复铁律）
b5b2e83 docs: 生成 BUG_INVENTORY.md 全面诊断报告
fbc91bf fix: 彻底修复 @codemirror/state 多实例冲突
b7dd7d2 fix: 修复 CodeMirror 多实例冲突导致编辑器无法渲染
```

---

## 2026-06-13（P0/P1 Bug 修复）

### 修复 4 个高优先级 Bug（遵循修复铁律）

**Bug#1 (P0): note-engine.ts:418 链式访问崩溃** ✅
- 问题：`db.exec('SELECT last_insert_rowid()')[0].values[0][0]` 三级链式访问无安全检查
- 修复：添加 `rowIdResults.length && values.length && values[0].length` 检查
- 影响：所有创建操作（书/卷/笔记）
- 测试：`bug-fix-verification.test.ts` Bug#1 用例通过

**Bug#3 (P0): sync-engine.ts 哈希验证永远失败** ✅
- 问题：恢复时对密文计算 SHA-256 与 manifest 中的明文哈希比较，验证永远不通过
- 修复：改为验证文件大小 > 0（因为加密文件无法与明文哈希比较）
- 影响：云端恢复功能
- 测试：`bug-fix-verification.test.ts` Bug#3 用例通过

**Bug#6 (P1): image-engine.ts 未处理 Promise** ✅
- 问题：`setTimeout(() => { flushSyncQueue() }, delay)` 中 async 函数无 .catch()
- 修复：添加 `.catch(err => console.error(...))` 错误处理
- 影响：图片惰性同步
- 测试：`bug-fix-verification.test.ts` Bug#6 用例通过

**Bug#13 (P1): encryption.ts 缺 try-catch** ✅
- 问题：`getKey()` 和 `sha256()` 中 `crypto.subtle` 调用无 try-catch
- 修复：两个函数都添加 try-catch，抛出明确的中文错误信息
- 影响：非 HTTPS 环境下加密/哈希功能
- 测试：`bug-fix-verification.test.ts` Bug#13 用例通过

### 修复铁律遵守情况
1. ✅ 先写失败测试，证明 bug 存在
2. ✅ 最小化修改：4 个 bug 共修改 4 个文件
3. ✅ 新增 4 个测试全部通过（旧测试 4 个失败为已有问题）
4. ✅ 未修改 encryption.ts 中的固定密钥
5. ✅ 未添加后端服务器代码
6. ✅ 未破坏本地优先架构，未自动删除用户文件
7. ✅ 不需要修改需求文档

## 2026-06-13（编辑器+搜索+同步修复）

### 搜索结果具体到段落 + 高亮关键词
- FTS5 snippet 改为从 content 列（列2）取80字符段落
- snippet 添加 `...` 省略标记
- fallbackSearch 返回的 snippet 中用 `<mark>` 高亮匹配的标题关键词
- SearchModal 中 safeSnippetHtml 正确渲染 `<mark>` 高亮标签

### 同步按钮直接打开云盘同步 + 未配置提示
- 首页云同步按钮改为直接打开设置弹窗的「云盘同步」子页面
- CloudSettingsContent 添加未配置时的引导提示（黄色提示框）
- settingsInitialPage 类型扩展支持 'cloud'

### 编辑器默认纯文本模式 + 亮色主题
- 默认 viewMode 从 'preview' 改为 'edit'（纯文本编辑优先）
- 移除 oneDark 暗色主题，替换为自定义亮色主题（白色背景、紫色光标、浅蓝选中）
- 移除 @codemirror/theme-one-dark 依赖，减少包体积

### 撤销/重做 + 插入日期时间
- 工具栏添加撤销/重做按钮（仅编辑模式显示）
- 工具栏添加插入日期时间按钮
- 快捷键 Ctrl+Shift+D 插入当前日期时间（格式：YYYY-MM-DD HH:MM）
- 使用 @codemirror/commands 的 undo/redo 命令

## 2026-06-13（搜索功能修复）

### 修复搜索功能 7 个问题

**问题 1（严重）：`fallbackSearch` SQL 参数数量不匹配** ✅ 已修复
- 文件：`note-engine.ts`
- 修复：`params: [like, like]` → `params: [like]`
- 效果：FTS5 不可用时降级搜索恢复正常

**问题 2+3（严重）：SearchModal scope 未传递 + 缺少 bookId** ✅ 已修复
- 文件：`SearchModal.tsx` + `HomePage.tsx`
- 修复：添加 `currentBookId` prop，doSearch 根据 scope 决定是否传入 bookId
- scope 变化时触发重新搜索
- HomePage 传递 `expandedBookId` 给 SearchModal

**问题 6：搜索范围按钮 UX 不佳** ✅ 已修复
- 修复：从单个切换按钮改为两个独立按钮（"当前书" + "全部书"）
- 默认选中"当前书"
- 选中状态：蓝色填充 + 白色文字 + 阴影，未选中：灰色背景

**问题 7：搜索结果展示优化** ✅ 已修复
- 优化层级缩进间距，更清晰的书→卷→笔记层级
- 搜索结果区添加分隔线
- 空结果时增加提示"尝试更换关键词或切换搜索范围"
- 搜索输入区与结果区用分隔线分开

**问题 4+5（中等）：FTS5 中文分词** ⚠️ 部分改善
- FTS5 默认 tokenizer 对中文支持差的根本问题未改变
- 但修复了 fallbackSearch 后，FTS5 查询失败时会正确降级到 LIKE 搜索
- LIKE 搜索可以匹配标题中的中文关键词
- 后续可考虑 `tokenizer="icu"` 改善

## 2026-06-13（搜索问题记录）

### 搜索功能问题清单（待修复）

经代码审查发现以下问题，搜索"同步"等关键词无结果：

**问题 1（严重）：`fallbackSearch` SQL 参数数量不匹配**
- 文件：`note-engine.ts` 约 1226-1275 行
- SQL 只有 1 个 `LIKE ?` 占位符，但 params 传了 `[like, like]` 两个值
- sql.js 参数不匹配时直接抛异常 → catch 返回空数组
- 结果：FTS5 不可用时降级搜索完全失效

**问题 2（严重）：搜索弹窗 scope 未传递给 searchNotes**
- 文件：`SearchModal.tsx` 第 55 行
- `doSearch` 始终传 `undefined` 作为 bookId，scope 状态是"死状态"
- 切换"当前书/全部书"不会触发重新搜索
- scope 变化未加入 useEffect 依赖列表

**问题 3（中等）：SearchModal 未接收当前 bookId prop**
- 文件：`SearchModal.tsx` 接口 + `HomePage.tsx` 调用处
- 即使修复问题 2，"当前书"模式也无法工作（不知道当前是哪本书）

**问题 4（中等）：FTS5 触发器 content 列始终为空字符串**
- 文件：`database.ts` 第 132-149 行
- 触发器写入 `content = ''`，依赖 `updateFTSContent()` 手动更新
- 如果 `updateFTSContent` 失败（静默设置 fts5Available=false），FTS 索引中只有标题无内容

**问题 5（中等）：FTS5 中文分词差**
- FTS5 默认 tokenizer `unicode61` 对中文支持差
- 中文不会被自动分词，搜索"同步"可能匹配不到包含"同步"的文本
- 需要考虑 `tokenizer="icu"` 或对中文直接走 LIKE 降级

### UI 问题清单（待修复）

**问题 6：搜索范围按钮 UX 不佳**
- 当前"当前书/全部书"是一个切换按钮，不直观
- 用户要求：改为两个独立按钮，默认选中"当前书"
- 按钮按下状态要明显（高亮/填充色）

**问题 7：搜索结果案例错位和显示不直观**
- 用户反馈搜索结果展示有错位
- 需要优化搜索结果的布局和视觉呈现

## 2026-06-13（UI 重构）

### 视觉升级 + 弹窗化改造

**目标**：解决页面跳转频繁、界面老气的问题，改为以首页为主框架、弹窗内完成所有操作。

**改动**：

1. **UI 视觉升级**
   - 配色方案从灰色调改为现代蓝紫色调（primary: 234 89% 63%）
   - 弹窗组件：圆角 xl、backdrop-blur 遮罩、zoom 动画
   - 按钮组件：添加阴影和 active:scale 按压反馈
   - Markdown 预览样式全面优化（表格、引用、代码块、链接）
   - 自定义滚动条、选中文字颜色

2. **设置页面弹窗化**
   - SettingsModal：设置从路由跳转改为弹窗内子页面模式
   - 支持外部指定初始子页面（initialPage）
   - 包含 8 个子页面：云盘同步、模板管理、图片设置、回收站、数据导出、安全加密、数据库管理、关于

3. **搜索弹窗化**
   - 新增 SearchModal 组件，替代搜索页面跳转
   - 保留 FTS5 全文搜索 + 防抖 + 按书卷分组

4. **首页布局重构**
   - 从单列列表改为左右分栏（目录树 + 编辑区）
   - 回收站、模板管理改为弹窗模式（不再跳转 /settings/*）
   - 云同步按钮改为打开设置弹窗

5. **路由清理**
   - 移除 SearchPage、SettingsPage、TrashPage、TemplatePage、CloudManagePage、ImageSettingsPage、AboutPage 的路由
   - 旧路由保留重定向到首页兼容
   - 主包体积从 504KB 降至 355KB

## 2026-06-12（修复）

### 存储层迁移：File System Access API → OPFS

**问题**：`showDirectoryPicker()` 仅在桌面 Chromium 浏览器上支持，Firefox/Safari/移动端均不支持。
用户点击"选择文件夹"后无响应，无法创建书。

**方案**：完全迁移到 OPFS（Origin Private File System）
- `navigator.storage.getDirectory()` — 浏览器内置私有文件系统
- 无需用户手动选择目录，无需权限弹窗
- 支持所有现代浏览器：Chrome 102+ / Firefox 111+ / Safari 16.4+ / Edge
- API 与 File System Access API 完全一致（getFileHandle/getDirectoryHandle/removeEntry/createWritable）
- 数据自动按域名隔离，浏览器 profile 绑定

**改动**：
- `storage.ts`：移除 IndexedDB 句柄持久化（OPFS 原生持久化），移除 `showDirectoryPicker` 调用
  - `initStorage()` 替代 `requestStorageDirectory()`，一行 `navigator.storage.getDirectory()` 搞定
  - 所有文件操作方法保留，签名不变
- `HomePage.tsx`：移除"选择数据存储位置"界面，改为自动初始化
  - 初始化失败时显示错误信息 + 重试按钮
- `file-system.d.ts`：移除 `showDirectoryPicker`/`queryPermission`/`requestPermission` 类型定义
  - 保留 `Symbol.asyncIterator`（`listDirectory` 需要）

### Bug 修复：数据库未初始化
- **问题**：第二次打开应用时，存储句柄被缓存但数据库实例（内存中）丢失
- **修复**：统一每次都初始化数据库，不再区分"首次"和"再次"路径
