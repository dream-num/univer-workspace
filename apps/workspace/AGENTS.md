# Univer Workspace 协作约定

本文件适用于 `apps/workspace/**`。该应用存在部署实例和需要保留的持久化数据，不按可随时
重建的一次性 Demo 处理。

## 数据库与部署

- 修改产品数据库 schema 前，先阅读 `docs/data-model.md`、`server/src/db/schema.sql` 和
  `server/src/db/migrations/prepare-current-database.ts`，确认当前版本与已支持的升级路径。
- 已发布 schema 的结构或约束发生变化时，必须提升 `PRAGMA user_version` 并提供版本化迁移；
  不得只修改 `schema.sql`，不得要求正常部署执行 `db:reset`，不得假设线上数据库为空。
- 迁移必须在业务 Repository 初始化前运行，并包含迁移前一致性备份、事务失败回滚、Schema
  指纹校验、`foreign_key_check` 和 `integrity_check`。
- 迁移必须保留已有业务数据、对象存储身份和恢复状态。删除或改写字段时，要明确旧数据到新
  语义的映射；不能静默丢弃仍可能被启动恢复流程使用的数据。
- 部署升级不得让不兼容的旧、新版本进程同时写同一个 SQLite 文件。发布说明应明确停旧实例、
  启动单个新实例完成迁移、确认成功后再恢复服务的顺序。
- `db:reset` 只用于用户明确要求清空数据的可丢弃环境；普通启动、重启和升级必须保留数据库。

## 迁移验证

数据库变更至少验证：

- 从当前线上版本迁移到目标版本，覆盖空表、已发布数据和未完成恢复状态；
- 迁移失败时事务回滚，原版本仍可识别，备份文件完整可读；
- 迁移后再次启动不会重复迁移或重复创建备份；
- 使用生产构建产物执行迁移，而不只在 TypeScript 源码测试环境运行；
- `pnpm typecheck`、`pnpm test` 和 `pnpm build` 全部通过。

涉及数据库版本、迁移路径或部署行为时，同步更新 `README.md`、`docs/data-model.md`、
`docs/application-design.md` 和相关 proposal；代码、测试、当前 Schema 与文档必须描述同一版本。
