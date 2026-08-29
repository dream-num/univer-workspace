# Univer Observer 协作约定

本文件适用于 `apps/observer/**`。Observer 是独立部署应用，不属于 Workspace Server 的模块。

## 运行边界

- Observer 必须使用独立 HTTP 进程、GitHub OAuth App、Session Cookie 和 SQLite 文件。
- 产品数据库和 Collaboration 数据库只允许以 SQLite `readOnly` 与 `query_only` 模式打开；Observer
  不创建、迁移、索引或修复这些数据库。
- 不从 `apps/workspace/**` 导入源码。Observer 可以依赖同一版本仓库所描述的持久化 Schema，但必须
  在启动或查询时显式校验兼容性。
- Changeset 查询必须保留时间范围、超时和并发上限，不得把 Payload 或 Mutation 内容返回给页面。

## Observer 数据库

- Observer SQLite 是不可丢弃的部署状态。修改已发布 Schema 时必须提升 `PRAGMA user_version`，
  增加版本化迁移、迁移前备份、事务回滚、Schema 指纹、`foreign_key_check` 和 `integrity_check`。
- 普通启动、升级和恢复不得重置数据库。未知版本或部分 Schema 必须拒绝启动。
- Member 变更、Session 撤销和访问历史必须维持现有事务与不可修改语义。

## 验证

修改运行边界、Schema 或部署方式时，至少运行 Observer 的 OpenAPI 校验、类型检查、测试和生产构建，
并同步更新 `README.md`、`docs/architecture.md` 与 `docs/data-model.md`。
