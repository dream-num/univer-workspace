---
status: accepted
---

# Observer 只读访问 Workspace 数据库

Observer 以只读方式直接读取配置的 Workspace 产品与 Collaboration SQLite，补全展示元数据并汇总
Trunk 与 Worktree Changeset 活动。这会有意让 Observer 依赖同一仓库版本的持久化 Schema，换取
无需复制数据即可查询权威最新历史。Workspace 与 Collaboration Adapter 仍独占写入和迁移所有权；
Observer 在独立进程中运行，集成测试必须发现不兼容的 Schema 变化。
