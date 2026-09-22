# Unit 内容编辑保护：验证与合入条件

当前 SDK：`1.0.0-rc.0`。此变更必须保持 Draft。

**禁止在新 SDK 发布前合入。** 升级至包含
[SDK #82 修复](https://github.com/dream-num/univer-collaboration-sdk/issues/82)的正式发布包后，
统一更新所有耦合 SDK manifest 和 lockfile，并重新运行完整验证，才可解除 Draft。
不得使用相邻源码、跳过测试、expected-failure 或放宽授权把失败变绿。

## 范围

- 五类 Unit 的公开 SDK 内容保护对象；只限制编辑。
- Editor 可以创建；创建者与当前 Owner/Admin 管理；始终受当前文件权限约束。
- Worktree 读取当前 Trunk ACL；拒绝创建/修改 ACL 和修改保护绑定；合并再次校验当前权限。
- V7 → V8 只新增两张产品授权表和索引，保留旧数据、Blob 身份和恢复状态。
- SDK Authz 协议适配不新增产品 OpenAPI。无 SDK 源码补丁、版本升级或部署改动。

## 可重复验证

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm --filter @univerjs/univer-workspace test:production-import
pnpm --filter @univerjs/univer-workspace exec vitest run --config vitest.config.ts test/integration/collaboration-gateway.test.ts
```

集成测试使用真实产品应用、已发布 SDK、认证 HTTP/WebSocket；HTTP `200` 只代表收件，
写入必须收到 `changeset_ack`，拒绝必须收到 `permission_rej`，不能仅断言 HTTP 状态。

覆盖：14 类对象的创建/查询/更新、Viewer/外部用户越权、跨 Unit 隔离、有限协作者候选、
Owner 接管、创建者失去文件权限、重启持久化；Sheet 单元格、Doc 段落、Slide 元素、
Board 元素、Base 视图的真实写入拒绝与未保护目标成功；Worktree 禁止管理、保护写入拒绝、
普通编辑合并成功、草稿写入后撤销 ACL 时合并不落入 Trunk。

迁移矩阵同时针对源码及生产构建：V0–V7 升级、V7 空库/已有 Blob 与未完成恢复状态、
迁移失败回滚及可读备份、重复启动、外键与完整性检查。

## 保留失败用例

`collaboration-gateway.test.ts` 中 `SDK #82: ordinary Editor can change tab color without collaborator-management rights`
是正常测试，不使用 skip/xfail。当前版本下普通单元格写入成功，未保护 Sheet 改标签颜色却收到
`permission_rej`。新 SDK 后此测试必须自然变绿，另须复验 Worktree 标签颜色写入及合并。

## 浏览器验证

使用独立临时产品库、协同库和 Blob 目录，在本地启动 Server/Vite，通过浏览器注册 Owner、Editor。
Owner 创建 Sheet、保护 A1、在 A2 普通写入；Editor 打开同文档，A1 输入显示无编辑权限，
A3 普通输入成功并显示已同步。重启 Server、刷新浏览器后，保护和 A2/A3 内容仍保留。
另创建 Doc，普通文本输入、节保护保存均显示已同步。
浏览器结果与真实 HTTP/WS 集成测试共同验证，未声称所有 SDK 命令组合都已覆盖。

## 最小修改与 review 记录

- 不过滤 snapshot/history/export；旧文档中已有隐藏规则不构成保密承诺。
- Sheet 的 SDK 面板仍显示隐藏内容选项，服务端拒绝该范围；本次不重做 SDK UI。
- UI 权限缓存更新可能需要刷新；服务端每次提交/合并重新读取 ACL，不依赖按钮状态。
- ACL 先于绑定持久化，未绑定或解绑对象保留供重试/undo/history；只在永久删除资源时级联清理。
- 候选成员仅列出明确 Space/祖先 Node 授权用户，不枚举全站、匿名或链接访问者。
- 所有保护覆盖依赖 SDK mutation 分析；不在 Workspace 复制分析器或兜底放行失败 mutation。
- 数据库提升版本和历史测试更新属于必要迁移范围，不涉及业务表重构。

## 本次执行结果

- 仓库 `pnpm typecheck`、`pnpm build` 通过。
- `pnpm test`：Workspace 288 通过，1 失败（仅 SDK #82）；其他 workspace 包测试通过。
- `test:production-import`：生产入口和 V0–V7 迁移全部通过。
- `git diff --check` 通过。

这些结果对应当前已发布 SDK，不满足最终合入要求；升级后须重新执行全部检查。
