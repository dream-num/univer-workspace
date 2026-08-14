---
status: accepted
---

# Separate product and collaboration persistence

产品目录数据和 Univer Collaboration 数据可以使用同一个物理数据库，但保持独立的
模块、数据表、接口和事务边界。产品仓储拥有 Space、Node 和 Resource，
Collaboration Database Adapter 只实现 Unit、snapshot、changeset 和 revision 等协同
持久化；跨边界创建由显式、幂等的可靠操作协调，避免为 `IDatabaseAdapter` 引入产品
语义。
