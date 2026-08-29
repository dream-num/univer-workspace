---
status: accepted
---

# 独立持久化 Observer Identity

Observer Identity、成员资格、Session 和访问历史保存在专用 SQLite 数据库中，不进入
Workspace 产品数据库或 Collaboration 数据库。这样可以让仅使用 GitHub 的 Observer 身份
边界独立于 Workspace User 和内容访问；代价是部署必须额外备份并显式升级一个持久数据库。
Changeset 活动仍然从权威 Collaboration 数据库查询，不复制到 Observer 持久化中。
