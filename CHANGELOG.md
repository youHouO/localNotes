# 需求变更记录

规则：新记录追加在顶部 | 格式：日期 + 变更内容 + 原因 + 影响范围

---

## 2026-06-14 加密方案变更：统一内置密钥

**变更内容**：
- 加密方式从"用户密码 PBKDF2 派生 + localStorage 随机密钥"改为"软件内置统一固定密钥 PBKDF2 派生"
- 所有用户使用同一套加密规则，不需要用户设置/记住密码
- 目标：保证数据不是明文存储即可，不追求用户级加密隔离

**原因**：
- 旧方案中用户忘记密码会导致数据无法解密
- 不同设备/浏览器的随机密钥不同，数据不能跨设备解密
- 实际需求只是"数据不是明文"，不需要用户级加密隔离

**影响范围**：
- `src/engine/encryption.ts`：`getKey()` 函数简化，去掉 localStorage 随机密钥路径
- `src/components/modals/SettingsModal.tsx`：加密设置 UI 简化，去掉"重新生成密钥"和"导出密钥"
- `src/engine/note-engine.ts`：`setEncryptionEnabled` / `isEncryptionEnabled` 保持不变

---

## 2026-06-14 存储位置选择流程变更

**变更内容**：
- 欢迎页从"直接弹系统文件夹选择器"改为"两屏流程"（欢迎介绍 → 存储位置选择）
- 存储位置默认在用户选择的文件夹下自动创建 `LocalNotes` 子目录
- 首次启动先检查 IndexedDB 有无已保存 handle，没有则显示欢迎页

**原因**：
- 旧方案直接弹系统对话框，用户不知道要做什么
- 没有功能介绍，新用户不了解软件特性
- 没有默认路径概念，数据可能存在任意位置

**影响范围**：
- `src/components/WelcomePicker.tsx`：完全重写为两屏流程
- `src/pages/HomePage.tsx`：`doInit` 先检查 handle 再决定是否显示欢迎页
- `src/engine/storage-fsaa.ts`：`initStorage` 支持 `defaultPath` 选项
- `src/engine/storage.ts`：新增 `initStorageWithHandle` 函数

**技术限制说明**：
- File System Access API 的 `showDirectoryPicker` 必须由用户点击触发，无法自动选择
- 无法在创建子文件夹后自动再次弹出选择器并导航到子文件夹
- 用户选择文件夹后，程序在后台自动创建 `LocalNotes` 子目录

---

## 2026-06-14 数据库 schema 迁移

**变更内容**：
- 新增 `runMigrations()` 函数，加载旧数据库后自动添加缺失列

**原因**：
- 旧数据库缺少 `note_count`、`word_count`、`image_count`、`synced`、`synced_at` 列
- 新代码查询这些列导致 `no such column` 错误

**影响范围**：
- `src/engine/database.ts`：新增 `runMigrations()` 函数
