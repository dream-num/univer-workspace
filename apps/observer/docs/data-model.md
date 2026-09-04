# Univer Observer 数据模型

Observer 身份与访问历史保存在 `OBSERVER_DATABASE_FILE` 指向的独立 SQLite 文件中，默认
`.data/univer-observer.sqlite`。它不属于 Workspace 产品数据库，也不保存观测汇总副本。

## Schema V1

- `observer_members`：以稳定 GitHub Numeric User ID 为主键；Login、Display Name 与 Avatar 是最近
  一次验证的展示资料；所有 Member 权限一致。
- `observer_sessions`：保存 Session ID、Secret Hash、Member、创建时间和过期时间。移除 Member 时
  通过 Foreign Key Cascade 撤销其全部 Session。
- `observer_access_events`：记录初始化、添加和移除的操作者、目标、结果与服务端时间。Trigger 禁止
  更新和删除。
- `observer_schema` 与 `PRAGMA user_version = 1`：共同标识文件身份和版本。

空文件会原子创建 V1。未知版本、错误身份、部分 Schema、Foreign Key 或 Integrity 错误都会拒绝
启动，不会自动重置。成功的 Member 变更与对应访问事件在同一事务中写入。

该数据库不保存 GitHub Access Token、Workspace Session、Workspace 内容、Changeset、活动汇总或
数据库查询结果。
