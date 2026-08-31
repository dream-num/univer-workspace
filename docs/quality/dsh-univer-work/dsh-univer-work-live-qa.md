# dsh-univer-work local live QA

状态：**PASS；真实 Workspace + 真实 DeepSeek Harness + Chrome；0 open plugin findings；1 个本地源码启动约束已定位**

执行时间：2026-08-31 00:19–01:00、08:12–08:31 CST。范围是把最终预构建 `dsh-univer-work` tarball 安装到本机
DSH Web profile，通过 Chrome 完成 Workspace 目录接入、浏览器授权、身份确认以及 Space/Node 的
create、rename、browse，以及 Worktree/Unit/content/render/review 的真实纵向链路，并在 Workspace Browser 交叉读回。测试没有使用 fixture
Workspace、替代 operation 或相邻源码解析。

## Runtime coordinates

| Component | Coordinate |
| --- | --- |
| Workspace worktree | `f1d945ea35a91b0e298c0801484ebfb60a688712` |
| DeepSeek Harness | `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e` |
| Workspace Server | `http://127.0.0.1:3020` |
| Workspace Browser | `http://127.0.0.1:5173` |
| DSH Web | `http://127.0.0.1:65305` |
| DSH Web parity extension | `http://127.0.0.1:3080` |
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

## `:3080` parity extension

第二轮使用同一 exact tarball、Workspace Server 和 Harness commit，在固定端口 `3080` 补齐 CLI 首版的
核心纵向链路。Harness 由当前 checkout 的 built entry 启动：

```bash
DSH_PERMISSION_MODE=danger-full-access \
  node apps/cli/lib/bin.js --profile web \
  --patch /tmp/dsh-univer-work-liveqa.ZIbvwp/browse-picker.patch.yml \
  --no-open --port 3080
```

| Step | Observed evidence | Result |
| --- | --- | --- |
| Installed plugin and auth reuse | `workspace_auth_whoami` 返回同一 `qa-user`；`workspace_space_list`、`workspace_api_find`、`workspace_resource_registries` 均由真实 Agent 调用成功。 | PASS |
| Node create | 一次性审批后创建 `DSH 3080 QA 2026-08-31 (06a11ca4-3d4e-4d1f-b9ad-69d8de82e3ba)`；Workspace Browser personal Space 列表显示同一 Node。 | PASS |
| Worktree create | personal Space 不能作为 team Space scope，首个 `scope=space` 请求按合同返回 `NOT_FOUND`；改用 `scope=user` 后创建 `DSH 3080 QA (ad7f858b-399a-4054-82f5-d1df874c10b8)`。 | PASS |
| Unit create and read | 创建 Worktree-local Sheet `0088a5ae-8c31-46ec-9a24-28d9e1eda452`；`workspace_unit_list` 返回同一 Unit。 | PASS |
| Worker-backed content write | `workspace_content_execute` 把 A1 写为 `DSH 3080 QA verified`，返回 `committed:true`、`revision:2`。 | PASS |
| Authoritative content read-back | `workspace_content_inspect` 从同一 Worktree/Unit 的 `Sheet 1!A1` 读回相同字符串。 | PASS |
| Worktree lifecycle | `workspace_worktree_get` 先返回 `draft`；一次性审批后 `workspace_worktree_ready` 成功，再次读取返回 `ready`。 | PASS |
| Review URL | `workspace_worktree_review_url` 返回 `/worktrees?...&view=agent`；Chrome 打开后显示“待确认”、只读预览和 `DSH 3080 QA Sheet`。未调用 merge 或 discard。 | PASS |
| Host-local screenshot | built Harness 下审批后 `workspace_screenshot` 生成 `Sheet-1-A1.png`，88×24 RGBA，SHA-256 `25060c0e41fcaf6e481a54ada32205afe319c18cbb2e09b95221144e2cdbdd3c`。PNG 以透明背景保存黑色单元格文本和蓝色边框。 | PASS |
| Chrome-only workspace picker | built Harness 中点击 “Add workspace” 打开页面内 `Select Workspace Directory`，可浏览 Host 目录；Cancel 后未改动 Workspace 列表，也未打开 Finder。 | PASS |
| Session restoration | 第二轮结束前再次恢复 `Full access`，UI 显示 `Access mode, current: Full access`。 | PASS |

### Source runner identity diagnostic

`pnpm dsh` 从该 Harness checkout 通过 `node --import tsx/esm apps/cli/src/bin.ts` 启动。此模式下
`ctx.fs` 是 `SandboxedFileSystem`，并且 `instanceof` 源码版 `src/LocalFileSystem` 为 true；installed
`dsh-univer-work` 通过公开 package export 加载 built `lib/LocalFileSystem`，因此同一对象对 built
constructor 的 `instanceof` 为 false。文件型工具按安全合同返回
`workspace-local-filesystem-required`。切换到 checkout 已构建的 `apps/cli/lib/bin.js` 后，Host 与插件
使用同一公开 `lib` identity，screenshot 立即通过。

这是本地源码 runner 与 installed plugin 混用造成的开发环境约束。QA 没有弱化
`requireLocal()`，也没有把相邻 Harness 源码加入 plugin artifact。installed package smoke 与 built
Harness 仍使用同一 public module identity。

## Findings and retained state

- 没有发现 `dsh-univer-work` 实现缺陷。文件型工具的首次失败来自上述 Harness source/built module
  identity 混用；built Harness 已完成真实修复性复验。`Full access` 的名称容易让测试者误以为它会自动允许插件的
  human approval；DSH rc.2 的实际合同是 `approval: never`，即关闭 prompt 并自动拒绝需要 approval 的
  operation。验证 mutation 时必须临时使用 `Workspace Write`，再选择一次性允许。
- Chrome directory-picker workaround 复用了 DSH rc.2 已交付的 browse picker，没有新增替代插件或
  Workspace 产品能力。
- 两个 QA Node 保留在 personal Space，名称分别带 `DSH Live QA` 与 `DSH 3080 QA`。第二个 Worktree
  保留为 `ready`，供 Workspace Browser 审核。本轮没有调用 trash、delete、merge 或 discard。
- `~/.dsh/profiles/web` 当前保留指向 exact QA tarball 的 `dsh-univer-work` 依赖；临时 picker patch 仅属于
  本次 DSH 进程。停止服务不会改写该 profile。

## Post-live gates

- `pnpm --filter dsh-univer-work typecheck`：PASS。
- `pnpm --filter dsh-univer-work test`：14 files / 624 tests PASS。
- `openspec validate --all --strict`：23 changes PASS，0 failed。
- `git diff --check`：PASS。
- 验收结束后端口 `3020`、`5173`、`65305`、`3080` 均无监听进程；exact tarball 与 profile 安装记录保留。

## Assessment

最终 tarball 在真实 DSH Web 中可被 Agent 发现和调用；浏览器授权建立了真实 Workspace GrantRecord；
Space/Node 的读、带一次性审批的写、再次读取及 Workspace Browser 交叉确认形成一条完整产品纵向链路。
该结果补充安装态 deterministic parity smoke，不替代已完成的 42-tool/8-Skill、Native/Code、heavy runtime、
package closure 与 lifecycle gates。
