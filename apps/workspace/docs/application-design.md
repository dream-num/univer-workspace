# Univer Workspace 应用层设计

本文定义产品 HTTP、Univer Collaboration Endpoint 与 V6 Node/Resource/Asset 数据模型之间的
模块边界。具体 HTTP 契约以 `contracts/http/openapi.yaml` 为准。

## 模块

```text
React
  ├── Product HTTP
  │     └── Application Modules
  │           ├── Identity
  │           ├── Spaces
  │           ├── Nodes
  │           ├── Resources
  │           ├── Blobs / BlobStore
  │           ├── Univer Assets / File Gateway
  │           ├── Permissions / Trash / Views
  │           ├── Worktrees
  │           └── Operations
  │
  └── Univer Collaboration Client
        └── Collaboration Endpoint
              ├── Login Session Authenticator
              ├── Collaboration Access Resolver
              └── Univer Collaboration Service
```

Product HTTP 与 Collaboration Endpoint 是两个入口，共享身份和权限模块，但不互相发起
HTTP 回调。Application Module 通过进程内 Interface 调用 Collaboration Service。

## 数据库启动边界

`db/initialize.ts` 在创建业务 Repository 前打开数据库。磁盘数据库先经过可整体删除的
`db/migrations` 准备阶段：

- Fresh：创建 V6；
- V6：校验 Schema 指纹；
- V5/V4/V3/V2/V1：一致性备份后逐版本迁移到 V6；
- V0：一致性备份后直接迁移到 V6；
- 其他状态：拒绝启动。

旧表读取只允许存在于这个可整体删除的迁移包中。Identity、Node、Resource、权限、
Worktree 等业务模块只编译和运行 V6 Query。

## Login Session Authenticator

所有产品 HTTP、Snapshot、Changeset、Session Ticket 和 WebSocket Upgrade 使用同一
Login Session：

```ts
interface LoginSessionAuthenticator {
  authenticate(cookieHeader: string | undefined):
    | { authenticated: false }
    | {
        authenticated: true;
        userId: string;
        sessionId: string;
      };
}
```

它只证明身份，不携带或缓存 Space、Node、Resource、Worktree Role。

## Access Resolver

产品 HTTP 与 Collaboration Endpoint 共用：

```ts
interface AccessResolver {
  resolveSpace(userId: string, spaceId: string): SpaceAccess | null;
  resolveNode(userId: string, nodeId: string): NodeAccess | null;
  resolveResource(userId: string, resourceId: string): ResourceAccess | null;
  resolveUnit(userId: string, unitId: string): ResourceAccess | null;
}
```

返回值包含有效 Role 和服务端 Capability；`null` 表示目标不可发现。Resolver 内部统一
处理：

- Space Owner 与 Team Membership；
- Node 祖先链上的 Direct Grant 和 Link Sharing；
- Trash 状态；
- Node/Resource 以及对应 Univer/Blob 扩展映射；
- Resource Node 是否有子 Node（与内容访问彼此独立）。

调用者不直接查询授权表或从客户端字段推断权限。Move 同时验证 Source、Target、同
Space 与后代链。

## Node 与 Resource 边界

Node Module 管理树、名称和位置：

```ts
interface NodesModule {
  listSpaceRoot(userId: string, spaceId: string, page: PageRequest): NodePage;
  get(userId: string, nodeId: string): NodeResponse;
  listChildren(userId: string, nodeId: string, page: PageRequest): NodePage;
  create(userId: string, input: CreateNode): NodeSummary;
  update(userId: string, nodeId: string, patch: PatchNode): NodeSummary;
}
```

任何 Node 都可调用 `listChildren`，是否有 Resource 不改变 Create Children 和 Browse
Children Capability。

Resource Module 管理内容身份和打开：

```ts
interface ResourcesModule {
  create(
    userId: string,
    idempotencyKey: string,
    input: CreateResource
  ): Promise<CreateResourceResult>;
  get(userId: string, resourceId: string): ResourceResponse;
  open(userId: string, resourceId: string): ResourceOpenView;
}
```

创建 Resource 同时创建新 Node；本版本不把 Resource 附加到已有 Node。Canonical 页面
使用 Node ID，内容 Open 使用 Resource ID。

Resource 是由 `kind` 判别的联合。现有 `POST /api/resources` 只创建 Univer Resource；
Blob Module 通过 Upload Session 接收字节，只有 Complete 才发布 Node/Resource。BlobStore
保存字节，产品数据库保存元数据和删除 Outbox；前端根据服务端检测的 MIME 自行选择预览。

Univer Asset Module 适配原生 File API。它将 Slide、Board、Base 等 Unit 内嵌资源保存到同一
`BlobStore`，但不创建 Node/Resource。Snapshot 只持有稳定 Asset ID；签名接口返回同域
`/content` 网关，网关在每次请求时重新解析 Unit/Worktree 权限并禁止缓存。Worktree-local
Asset 在对应 Unit 合入后发布到 Trunk。

## Collaboration Access Resolver

Collaboration Endpoint 不信任客户端提交的 Resource ID、Unit Type、Role 或
`editorMode`。它只接受认证 User、目标 Unit 和 Scope：

```ts
type CollaborationScope =
  | { kind: "trunk" }
  | { kind: "worktree"; worktreeId: string }
  | { kind: "mergePreview"; worktreeId: string };

type CollaborationAction =
  | "readSnapshot"
  | "submitChangeset"
  | "connect"
  | "issueSessionTicket";
```

Trunk Scope 通过 `univer_resources.unit_id` 反查 Resource，再解析所属 Node：

- Read/Connect 要求 Viewer 以上；
- Submit 要求 Editor 以上；
- Node 或祖先在 Trash 中时拒绝；
- Unit 不属于现有 Resource 时，普通 Trunk Endpoint 不可访问。

Worktree 和 Merge Preview 先解析 Worktree Visibility，再校验 Trunk Resource 或激活目标
Node 的实际访问权限。Visibility 不替代底层权限。

## Recent Seam

成功的 Product Resource Open 才调用 Recent Repository：

```ts
interface RecentResourceRecorder {
  recordOpened(userId: string, resourceId: string, openedAt: number): void;
}
```

Collaboration Snapshot 重试、Node 元数据加载、Worktree Preview 和失败打开都不写 Recent。

## Operation Runner

跨产品数据库与 Collaboration Service 的写操作以 Idempotency Key 固化意图和服务器生成
的 Node/Resource/Unit/Upload ID。Runner 只处理当前 Operation Kind 和 V3 JSON：

- 首次调用预留 ID；
- 同 Key 同意图返回已有状态；
- 同 Key 不同意图返回 Conflict；
- Retryable 错误保留 Pending 并由 Recovery Job 续跑；
- Non-retryable 错误进入 Failed，由显式 Retry 重新排队。

业务代码没有旧字段回退、旧表 Union、双写或旧 Route 转发。

## 客户端

客户端 Tree Row 总是 Node：

- `/nodes/{nodeId}` 是 Canonical URL；
- `hasChildren` 控制树展开；
- `resource === null` 表示纯组织 Node；
- `resource !== null` 时用 Resource ID 调 Open API；
- `resource.kind === "univer"` 时打开 Univer Editor；
- `resource.kind === "blob"` 时根据 MIME 选择预览，未知类型显示下载；
- 权限、Move、Trash 全部传 Node ID；
- Recent 和 Worktree 内容操作使用 Resource ID。

OpenAPI 生成类型是客户端与服务端的唯一 HTTP 结构约束。旧 Route 不在 OpenAPI 中，
Express 的未知 `/api/*` 路由直接返回 404，不落入客户端 SPA Fallback。
