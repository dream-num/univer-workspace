# Workspace 产品数据库适配器设计

SQLite 和 PostgreSQL 实现同一组产品 Repository 接口。协同库和文件存储各自管理数据。

## 目录与文件

以下路径相对于 `apps/workspace/server/src/`。以空间置顶举例，其他领域按现有模块归属组织。

```text
config.ts                            读取环境变量，产出 WorkspaceConfig.productDatabase
main.ts                              打开产品库、准备协同库、装配应用、管理关闭顺序
app.ts                               接收已打开的产品库接口，给各服务注入所需 Repository
modules/
  spaces/
    index.ts                         公开模块 API 和 Repository 接口类型
    spaces.repository.ts             空间列表、查询等领域接口
    space-pins.repository.ts         置顶列表的读取、整体替换、重置接口
    spaces.service.ts                依赖上述接口
    spaces.router.ts                 调用 service，等待结果后响应
db/
  index.ts                           对外导出工厂和接口类型
  product-database.ts                ProductDatabaseConfig、ProductDatabase 及 Repository 集合类型
  unit-creation-facts.ts             旧协同库升级所需的产品创建信息，只读接口
  open-product-database.ts           唯一按 config 选择产品数据库实现的工厂
  sqlite/
    open.ts                          准备数据库、打开连接、创建 SQLite Repository、提供 close
    initialize.ts                    校验、迁移并打开 SQLite 数据库
    connection.ts                    私有 DatabaseSync 连接和同步事务
    spaces/
      spaces.repository.ts           空间查询、SQL 与结果映射
      space-pins.repository.ts       置顶 SQL 与事务
    schema.sql                       SQLite V21 基线
    migrations/                      SQLite 版本识别、备份、升级和校验
    legacy-v0/                       SQLite V0 迁移入口
  postgres/
    open.ts                          建立连接池、准备 schema、创建各领域 Repository
    initialize.ts                    串行化首次建库，检查版本和结构指纹
    schema.sql                       PostgreSQL V1 基线
    transaction.ts                   在同一连接上开启事务、提交、回滚和重试
    spaces/
      spaces.repository.ts           同一空间接口的 PostgreSQL 实现
      space-pins.repository.ts       同一置顶接口的 PostgreSQL 实现
```

接口由使用它的业务模块定义，数据库目录按后端保存实现。`sqlite/initialize.ts` 在打开 `sqlite/connection.ts` 定义的连接前准备数据库，`sqlite/open.ts` 使用该连接装配各领域 Repository。SQLite schema 和所有历史迁移也在 `db/sqlite/`。生产构建从新目录复制 schema，历史验证同时扫描迁移前后的 Git 路径。

现有其余 Repository 分属 `access`、`blobs`、`content-permissions`、`html-view-drafts`、`identity`、`issues`、`nodes`、`operations`、`permissions`、`resources`、`skill-drafts`、`trash`、`univer-assets`、`views`、`worktrees`。模块的 `index.ts` 通过 `export type` 公开 Repository 契约。

## 外部能用什么

| 调用位置 | 允许的依赖 |
| --- | --- |
| `main.ts`、需要打开产品库的运维命令 | 从 `db/index.ts` 导入 `openProductDatabase(config.productDatabase)`，得到已经就绪的 `ProductDatabase` 接口 |
| `app.ts` | 接收已装配的 Repository 集合，向各模块分别注入所需接口 |
| 业务 Service、Router、后台任务 | 使用本模块的 Repository 接口或其他模块公开的 Service 接口 |
| `db/open-product-database.ts` | 按配置选择一个后端的 `open.ts`；各后端在自己的 `open.ts` 绑定具体实现和连接 |

例如，`createSpacesModule` 收到 `SpacePinsRepository`，类型来自 `modules/spaces/index.ts` 的 `export type`。实现类、SQL、驱动语句和连接均为后端私有。Repository 接口中的数据投影由领域模块定义。`WorkspaceApplication` 只接收 Repository 集合，产品库的打开和关闭由启动入口管理。测试若需构造 SQLite 历史数据，在 SQLite 专用 fixture 中使用原生连接。

## 配置和生命周期

`loadConfig()` 负责把环境变量解析为有判别字段的配置。SQLite 沿用 `DATABASE_FILE` 及其默认值，产出 `{ provider: "sqlite", filename }`。设置 `PRODUCT_DATABASE_PROVIDER=postgres` 后，从 `DATABASE_URL` 读取连接地址，产出 `{ provider: "postgres", connectionString }`。以下签名给启动入口生命周期控制权，`app.ts` 只接收 `database.repositories`。

```ts
export interface ProductDatabase {
  readonly repositories: ProductRepositories;
  readonly unitCreationFacts: UnitCreationFactsReader;
  close(): Promise<void>;
}

export declare function openProductDatabase(config: ProductDatabaseConfig): Promise<ProductDatabase>;
```

服务启动顺序为「产品库准备并打开 → 协同库升级 → 装配并启动应用」。工厂在构造 Repository 前完成产品库准备。启动入口只把 `unitCreationFacts` 交给协同迁移，需要升级时才读取创建人和时间。打开产品库的入口负责在后续启动失败或正常退出时关闭它，正常退出先等待使用数据库的任务和请求结束。[当前启动顺序](../../server/src/main.ts) · [旧库创建信息读取](../../server/src/integrations/univer/migrations/unit-creation-facts.ts)

`db:ban-agent` 也通过工厂和业务接口执行。产品库的选择独立于 `COLLABORATION_DATABASE_FILE` 和 `BLOB_STORE`。

## Repository 与事务

所有产品 Repository 的 I/O 都返回 Promise。Service、Router、启动和后台任务等待结果。SQLite 在单次方法调用内执行同步事务；事务回调中只使用同一连接，不能跨越 `await`。

- 创建 Team Space 时，在同一操作中分配 slug、插入并回读。修改设置时只写请求提供的字段。
- `replacePins` 在一个事务中复查置顶资格、替换顺序并回读列表。没有权限的请求保留原有置顶。
- 消费授权码与签发凭据、检查剩余配额与预留文件、校验目录树与移动节点分别属于一次原子操作。数据库适配器负责在并发请求下维持这些约束。
- 跨产品库、协同服务和 BlobStore 的写入通过持久化 Operation、幂等键和恢复流程衔接。

[依赖边界检查](../../test/unit/product-database-boundary.test.ts)约束后端导入。同一领域的实现应复用行为用例，覆盖并发写入、失败回滚与权限变化。SQLite 的历史兼容性由迁移矩阵和生产构建验证。

## PostgreSQL 事务与契约用例

`withPostgresTransaction` 在一个池连接上运行可串行化事务。序列化失败或死锁时，重试整个业务操作。事务回调只通过传入的连接访问产品库，外部通知和文件操作放在事务之外。

共享的应用用例覆盖 HTTP、权限、文件、草稿、Issue 和 Worktree，空间与置顶另有并发契约用例。提供 `WORKSPACE_TEST_POSTGRES_URL` 后，可用以下命令运行 PostgreSQL 套件，包括建库、重启及结构漂移检查。测试账号需要创建和删除独立 schema 的权限。

```bash
pnpm --filter @univerjs/univer-workspace test:postgres
```
