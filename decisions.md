# 重大决策记录

## 2026-06-14 saveDB() 异步持久化

**根因**: `saveDB()` 是 async 函数，但在 note-engine.ts 中所有调用点都是同步调用且未 await。更严重的是，`createBook`/`createVolume`/`createTemplate` 中 `saveDB()` 写在 `return` 之后成为死代码，导致数据修改后永远不会持久化到文件。

**解决方案**: 所有调用 `saveDB()` 的函数改为 async，`saveDB()` 调用移到 return 之前并添加 await。

**触发条件**: 创建/修改/删除任何数据后刷新页面，数据丢失。

---

## 2026-06-14 books 表 schema 缺失列

**根因**: `BASE_SCHEMA_SQL` 中 books 表缺少 `note_count` 列。`runMigrations()` 只在加载旧数据库时执行，新数据库不会执行迁移，导致首次创建书时 INSERT 失败。

**解决方案**: 直接在 `BASE_SCHEMA_SQL` 的 books 表定义中添加 `note_count INTEGER NOT NULL DEFAULT 0`。

**触发条件**: 全新安装后创建第一本书。

---

## 2026-06-14 image-engine 列名不匹配

**根因**: image-engine.ts 的 INSERT/SELECT 使用 `original_name`/`webp_name` 列，但 images 表 schema 中只有 `local_path`。接口定义与数据库 schema 完全不一致。

**解决方案**: 统一 image-engine.ts 的 SQL 和 `ImageInfo` 接口，使用 `local_path` 列。

**触发条件**: 粘贴/拖拽图片到笔记中。

---

## 2026-06-14 restoreFromTrash 恢复笔记数据丢失

**根因**: 恢复笔记时 `volume_id` 硬编码为空字符串，导致恢复后的笔记无法通过 `listNotes(volumeId)` 查询到。同时 `TrashItem.bookId` 对笔记类型存储的是 `volumeId` 而非 `bookId`。

**解决方案**: 
1. 恢复时从 trash 表读取 `parent_id` 作为 `volume_id`
2. 通过 `parent_id` 查询 volumes 表获取正确的 `bookId`
3. `listTrash` SQL 使用 LEFT JOIN volumes 获取正确的 bookId

**触发条件**: 从回收站恢复笔记后，笔记不可见。
