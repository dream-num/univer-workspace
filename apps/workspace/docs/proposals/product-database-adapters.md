# Workspace 产品数据库适配器设计

第一阶段交付现有 SQLite 行为，第二阶段接入 PostgreSQL。范围是 Workspace 产品数据；协同库和文件存储各自使用已有的适配器。

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
  postgres/                          第二阶段加入
    open.ts                          准备数据库、创建连接池、装配 Repository、提供 close
    migrations/                      PostgreSQL 自己的建库和升级脚本
    spaces/
      spaces.repository.ts           同一空间接口的 PostgreSQL 实现
      space-pins.repository.ts       同一置顶接口的 PostgreSQL 实现
```

接口由使用它的业务模块定义，数据库目录按后端保存实现。`sqlite/initialize.ts` 在打开 `sqlite/connection.ts` 定义的连接前准备数据库，`sqlite/open.ts` 使用该连接装配各领域 Repository。SQLite schema 和所有历史迁移也在 `db/sqlite/`。生产构建从新目录复制 schema，历史验证同时扫描迁移前后的 Git 路径。

现有其余 Repository 分属 `access`、`blobs`、`content-permissions`、`html-view-drafts`、`identity`、`issues`、`nodes`、`operations`、`permissions`、`resources`、`skill-drafts`、`trash`、`univer-assets`、`views`、`worktrees`。按实际业务操作迁移，模块的 `index.ts` 通过 `export type` 公开 Repository 契约。

## 外部能用什么

| 调用位置 | 允许的依赖 |
| --- | --- |
| `main.ts`、需要打开产品库的运维命令 | 从 `db/index.ts` 导入 `openProductDatabase(config.productDatabase)`，得到已经就绪的 `ProductDatabase` 接口 |
| `app.ts` | 接收已装配的 Repository 集合，向各模块分别注入所需接口 |
| 业务 Service、Router、后台任务 | 使用本模块的 Repository 接口或其他模块公开的 Service 接口 |
| `db/open-product-database.ts` | 按配置选择一个后端的 `open.ts`；各后端在自己的 `open.ts` 绑定具体实现和连接 |

例如，`createSpacesModule` 收到 `SpacePinsRepository`，类型来自 `modules/spaces/index.ts` 的 `export type`。实现类、SQL、驱动语句和连接均为后端私有。Repository 接口中的数据投影由领域模块定义。`WorkspaceApplication` 只接收 Repository 集合，产品库的打开和关闭由启动入口管理。测试若需构造 SQLite 历史数据，在 SQLite 专用 fixture 中使用原生连接。

## 配置和生命周期

`loadConfig()` 负责把环境变量解析为有判别字段的配置。第一阶段沿用 `DATABASE_FILE` 及其默认值，产出 `{ provider: "sqlite", filename }`。接入 PostgreSQL 时增加 `{ provider: "postgres", connectionString }`。以下签名给启动入口生命周期控制权，`app.ts` 只接收 `database.repositories`。

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

## 事务和第一阶段验收

空间与置顶 Repository 的 I/O 均返回 Promise。创建 Team Space 时，选择可用 slug、插入和回读属于同一次操作。一次设置更新只写请求提供的字段，并在事务内返回结果。其他模块仍有同步 I/O 接口，调整时需同时核对调用方和事务边界。

- **Repository 方法表达业务原子性。** 例如 `replacePins(userId, spaceIds, createdAt): Promise<StoredSpacePins | null>`。实现必须在一次事务内重查置顶资格、删除旧顺序并写入新顺序，成功返回事务内读回的最终列表，有空间无权置顶时返回 `null`。Service 和 Router 均等待结果。
- **跨表操作保持原子。** 例如 OAuth 兑换中的令牌状态校验与会话签发，由 Identity 提供一个原子操作。重构时逐项核对已有事务，避免拆成若干独立提交。跨产品库、协同服务、BlobStore 的工作继续沿用既有 Operation 和恢复流程。
- **按模块实施，按全库验收。** 先用空间置顶验证成功、无权限、顺序、中途失败回滚和 HTTP 行为，再迁其余 Repository，包含令牌服务、OAuth 路由、维护命令和测试中直接使用连接的入口。第一阶段以业务代码全部通过接口访问产品库作为完成条件。
- **自动检查边界。** 在 `apps/workspace/test/unit/product-database-boundary.test.ts` 检查生产代码对后端目录、数据库驱动和具体实现的导入与再导出，仅放行工厂及后端内部装配。保留协同库自己的驱动边界。置顶等契约用例放在 `apps/workspace/test/integration/`，第二阶段让两种后端运行同一组行为测试。SQLite 重构需通过既有迁移矩阵和生产构建验证。
