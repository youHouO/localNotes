# 待办列表
最后更新：2026-06-13

## 已完成

### 存储层重构
- [x] storage-fsaa.ts: FSA API 存储层
- [x] storage-opfs.ts: OPFS 降级方案
- [x] storage-handle.ts: Handle IndexedDB 持久化
- [x] storage.ts: 统一入口（工厂模式 + 并发锁）
- [x] WelcomePicker.tsx: 首次使用引导页
- [x] HomePage.tsx: 初始化流程集成 picker
- [x] file-system.d.ts: FSA API 类型声明
- [x] config.ts: 存储相关配置

### 引擎模块
- [x] database.ts: SQLite 封装（sql.js）
- [x] encryption.ts: 加密模块（Web Crypto API）
- [x] note-engine.ts: 笔记 CRUD / 搜索 / 回收站 / 模板
- [x] image-engine.ts: 图片存储 + 同步状态
- [x] export-engine.ts: 导出引擎
- [x] sync-engine.ts: 同步引擎
- [x] builtin-notes.ts: 内置笔记

### Bug 修复（BUG_INVENTORY 全部 16 个）
- [x] P0 #1: db.exec 链式访问
- [x] P0 #4: OPFS → FSA API
- [x] P1 #5: 软删除 → .trash
- [x] P1 #6: setTimeout async catch
- [x] P1 #11: 图片提前同步
- [x] P1 #12: 退出笔记未同步提示
- [x] P1 #13: getKey try-catch
- [x] P1 #14: exportRawKey try-catch
- [x] P2 #19: 创建时间排序
- [x] P2 #23: 手动同步按钮
- [x] P2 #46: ESLint 配置
- [x] P3 #41-#45: 边界情况

### 移动端适配
- [x] 侧边栏 fixed 定位 + 遮罩层
- [x] 顶部栏移动端精简
- [x] 更多菜单 click toggle
- [x] 搜索框响应式
- [x] 弹窗边距适配

### 编辑器
- [x] CodeMirror 多实例冲突修复
- [x] 预览模式 DOM 销毁
- [x] 搜索回调 keyword/matchLine

---

## 待完成

### 功能完善
- [x] note-engine.ts: `loadNote` 实际从 storage 读取笔记内容
- [x] note-engine.ts: `saveNote` 实际写入内容到 storage 文件 + SHA256 哈希 + 图片计数
- [x] note-engine.ts: `restoreFromTrash` 实际从 .trash 移回文件并恢复完整元数据
- [ ] image-engine.ts: 图片 WebP 压缩（当前直接保存原始数据）
- [ ] image-engine.ts: `syncImages` 实际调用云盘上传 API
- [ ] export-engine.ts: ZIP 导出使用 JSZip 库（当前返回 JSON）
- [ ] export-engine.ts: HTML 导出使用 marked 库渲染 Markdown
- [ ] sync-engine.ts: 实际实现 WebDAV/FTP/SFTP/S3 协议通信
- [ ] encryption.ts: 笔记内容加密存储集成

### 测试
- [x] 更新 note-engine.test.ts 适配新的引擎实现（30 个用例全部通过）
- [x] database.ts 单元测试（12 个用例全部通过）
- [x] encryption.ts 单元测试（13 个用例全部通过）
- [ ] storage 层集成测试

### UI/UX
- [x] NoteEditor: 退出笔记时按未同步图片数量区分 Toast/确认框
- [ ] CloudManagePage: 同步进度弹窗
- [ ] SettingsModal: 加密设置 UI 对接 encryption.ts
- [ ] 弹窗关闭按钮（P2 低优先级）

### 兼容性
- [ ] Chrome/Safari/Firefox 移动端测试
- [ ] 编辑器 basicSetup 验证（撤销/重做/日期等）
