# dsh-univer-work local live QA

状态：**PASS；真实 Workspace + 真实 DeepSeek Harness + Chrome；0 open plugin findings**

执行时间：2026-08-31 00:19–01:00 CST。范围是把最终预构建 `dsh-univer-work` tarball 安装到本机
DSH Web profile，通过 Chrome 完成 Workspace 目录接入、浏览器授权、身份确认以及 Space/Node 的
create、rename、browse 真实纵向链路，并在 Workspace Browser 交叉读回。测试没有使用 fixture
Workspace、替代 operation 或相邻源码解析。

## Runtime coordinates

| Component | Coordinate |
| --- | --- |
| Workspace worktree | `d2e51a25ef05bd662cb4a88ba6ff68236577269a` + 当前未提交实现 |
| DeepSeek Harness | `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e` |
| Workspace Server | `http://127.0.0.1:3020` |
| Workspace Browser | `http://127.0.0.1:5173` |
| DSH Web | `http://127.0.0.1:65305` |
| Packed artifact | `/tmp/dsh-univer-work-liveqa.ZIbvwp/dsh-univer-work-0.0.0.tgz` |
| Artifact SHA-256 | `1a4891eea2b553dfd16687b4898fc29096b7743426dc2153d272e10ead99a47f` |
| Artifact SHA-1 | `b0d152a64e45e98dd9ce24da435aed0adfb98267` |
| Artifact packed size | `12,945,730` bytes |

DSH profile `web` 从上述 exact tarball 加载 `dsh-univer-work`。启动时附加临时 patch，禁用会打开
Finder 的 `@deepseek-ai/dsh-host-directory-picker-auto`，改用 Harness 已有的
`@deepseek-ai/dsh-host-directory-picker-browse` 与
`@deepseek-ai/dsh-client-ui-directory-picker-browse`。该 patch 没有进入产品源码或用户 profile。

## Live acceptance ledger

| Step | Observed evidence | Result |
| --- | --- | --- |
| DSH plugin discovery | DSH Web 启动后加载 `dsh-univer-work`；此前 exact installed package gate 已锁定 42 tools / 8 Skills，本轮 Agent 能直接调用 `workspace_*` tools。 | PASS |
| Chrome-only workspace picker | “Add workspace” 打开页面内 `Select Workspace Directory`，输入并选择 `/Users/shenweimin/github.com/dream-num/univer-workspace`；没有打开 Finder。侧栏出现 `univer-workspace`。 | PASS |
| Browser authentication | DSH 调用 `workspace_auth_start` 得到本地 Workspace approval URL；Chrome 中登录的 `qa-user` 完成授权；随后 `workspace_auth_complete` 和 `workspace_auth_whoami` 返回 `qa-user (c593ec34-f91d-4e02-b8b2-98b09003e9c3)`。报告不保留一次性 user code。 | PASS |
| Space discovery | `workspace_space_list({})` 返回一个 personal Space：`qa-user 的个人空间 (19a28885-75fa-417b-b192-1e69b318c806)`。 | PASS |
| Approval fail-closed | DSH `Full access` preset 实际组合为 `danger-full-access + approval: never`；两次 `workspace_node_create` 在进入 operation body 前自动返回 `the user rejected tool`，页面没有审批面板，也没有创建 Node。 | PASS，符合 Harness policy |
| Interactive one-shot approval | 将当前会话临时切到 `Workspace Write`（`approval: ask`）后，真实审批面板显示 `Reject` / `Allow once`。选择 `Allow once` 后 operation 才执行。 | PASS |
| Node create | `workspace_node_create` 在 personal Space 创建 `DSH Live QA 2026-08-31 (93e3ac8e-eea0-4504-82f4-cc7ac50d275c)`。 | PASS |
| Node rename | 第二次独立 `Allow once` 后，`workspace_node_rename` 返回 `DSH Live QA 2026-08-31 verified (93e3ac8e-eea0-4504-82f4-cc7ac50d275c)`。 | PASS |
| DSH read-back | `workspace_space_browse({"space_id":"19a28885-75fa-417b-b192-1e69b318c806"})` 返回 `/DSH Live QA 2026-08-31 verified` 与同一 Node id。 | PASS |
| Product UI read-back | Chrome 打开 `/spaces/19a28885-75fa-417b-b192-1e69b318c806`，Workspace Browser 显示 `DSH Live QA 2026-08-31 verified`。 | PASS |
| Session restoration | 验收结束后将 DSH access preset 恢复为 `Full access`，UI 显示 `Access mode, current: Full access`。 | PASS |

## Findings and retained state

- 没有发现 `dsh-univer-work` 实现缺陷。`Full access` 的名称容易让测试者误以为它会自动允许插件的
  human approval；DSH rc.2 的实际合同是 `approval: never`，即关闭 prompt 并自动拒绝需要 approval 的
  operation。验证 mutation 时必须临时使用 `Workspace Write`，再选择一次性允许。
- Chrome directory-picker workaround 复用了 DSH rc.2 已交付的 browse picker，没有新增替代插件或
  Workspace 产品能力。
- QA Node 保留在 personal Space，名称明确带 `DSH Live QA`。本轮没有调用 `workspace_node_trash`，因此
  没有额外删除操作。
- `~/.dsh/profiles/web` 当前保留指向 exact QA tarball 的 `dsh-univer-work` 依赖；临时 picker patch 仅属于
  本次 DSH 进程。停止服务不会改写该 profile。

## Post-live gates

- `pnpm --filter dsh-univer-work typecheck`：PASS。
- `pnpm --filter dsh-univer-work test`：14 files / 624 tests PASS。
- `openspec validate --all --strict`：23 changes PASS，0 failed。
- `git diff --check`：PASS。
- 验收结束后端口 `3020`、`5173`、`65305` 均无监听进程；exact tarball 与 profile 安装记录保留。

## Assessment

最终 tarball 在真实 DSH Web 中可被 Agent 发现和调用；浏览器授权建立了真实 Workspace GrantRecord；
Space/Node 的读、带一次性审批的写、再次读取及 Workspace Browser 交叉确认形成一条完整产品纵向链路。
该结果补充安装态 deterministic parity smoke，不替代已完成的 42-tool/8-Skill、Native/Code、heavy runtime、
package closure 与 lifecycle gates。
