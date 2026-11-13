# Sheet outline、read、find plan

Agent 读远程 Sheet 时，用 `outline` 看结构、用 `outline --at` 和 `read` 放大、用 `find` 定位，不截图、不写统计脚本。
本计划把 [design.zh-CN.md](./design.zh-CN.md) 拆成四个 PR，按 stack 交付。
贯穿全程的规则是三点：只接受 Sheet Unit，其他类型明确报错并指向 `inspect`；resolve 由服务端给出权威修订号；
共享 skill 不出现 `uvw`。
PR 顺序是 SL1（Lens、引擎和 CLI）、SL2（MCP 工具）、SL3（skill），SL4（大表阈值）在 SL1 合入后从 `main` 单独开分支。

## How to read this

One box is one unit of work. Every box names the evidence that checks it. A nested box is a sub-step of the box above it. Check a box only when its evidence exists, a file, a log line, a screenshot, a test run, or a SHA. The body is a how-to. The appendices explain and record.

The program runs `pstack/skills/poteto-mode/playbooks/autopilot-stack.md`. 执行者只构建和验证，不合入。SL1、SL2、SL3、SL4 都停在 merge-ready，由操作者合入。

在 Herdr 里且装有 Codex 时，代码编写和验证委托按 `~/.claude/rules/pstack-codex-delegation.md` 交给 Codex，其余角色用 pstack 自己的子 agent。

Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

## Program checklist

### Arm the program

- [ ] State the protocol and this plan to the operator, then stop. Start execution only on the operator's explicit go.
  操作者 2026-11-13 确认：命令用顶层动词 `outline`、`read`、`find`；CLI 缓存上限 512 MB，SL1 实测后复核；本期只做 uvw 和 MCP，不做 DSH 插件。
- [ ] Read these from trunk at program start. Re-read them at every tick.
  - [ ] `git show origin/main:docs/design/sheet-outline/plan.zh-CN.md`，本计划。pstack playbook 不在本仓库，从本机插件目录读取 `pstack/skills/poteto-mode/playbooks/autopilot-stack.md`。
  - [ ] 本机插件目录的 `pstack/skills/swarm/SKILL.md`。
  - [ ] `git show origin/main:.agents/skills/verify-uvw/SKILL.md`，CLI 和 MCP 的控制方式。CLI 用 verify-uvw 包装的源码版 `uvw` 驱动。
  - [ ] 本机插件目录的 `pstack/skills/poteto-mode/playbooks/opening-a-pr.md`。
  - [ ] `git show origin/main:docs/design/sheet-outline/design.zh-CN.md` 和 `prototype.zh-CN.md`。
- [ ] On the operator's go, arm the audit tick as `/loop 1h` with the tick prompt below. Never leave the cadence to memory.
- [ ] Use this tick prompt, verbatim. "Re-read the execution playbook from trunk. Audit the operation against it and fix drift in this tick. Probe every active lane and judge progress by side effects only. Stand down a stuck lane and dispatch its replacement now. Then post a short status message to the operator in chat only when the audit found a tracked change that no earlier status message reported, such as a PR opened, a code-ready head, a round launched or closed, a verdict, a merge, a stuck agent and the action taken, a blocker added or cleared, or a decision only the operator can make. Name every such change and nothing else. Do not repeat a table, the merged list, or an unchanged blocker. If the audit found none, end the turn with no reply text. Either way, log this tick's row in your decision trail. The row names the items reported, or none."
- [ ] On the operator's hold or stand-down, send every owner a zero-writes order at once.

### Spawn owners

- [ ] Spawn one owner per PR with the full lifecycle the execution playbook names.
- [ ] Follow this dependency graph. Start dependent work only after its parent merges, or base it on the parent branch when the execution playbook stacks.
  - [ ] SL1 is first. It branches from `main`.
  - [ ] SL2 after SL1. SL2 branches from the SL1 branch.
  - [ ] SL3 after SL2. SL3 branches from the SL2 branch.
  - [ ] SL4 after SL1 merges. SL4 branches from `main`.
- [ ] Hold the file boundaries. SL1 touches only `packages/client-core/**`、`apps/cli/src/**`、`apps/cli/test/**`、`apps/cli/README.md`、`.agents/skills/verify-uvw/**`、`docs/design/sheet-outline/media/**`。SL2 touches only `apps/mcp/src/**`、`apps/mcp/test/**`、`apps/mcp/README.md`、`docs/design/workspace-mcp/**`、`.agents/skills/verify-uvw/features/**`。SL3 touches only `apps/cli/skill-data/**`、`apps/mcp/skills/**`、`apps/mcp/test/core-skill.test.ts`。SL4 touches only `packages/client-core/**`、`apps/cli/src/runtime/**`、`apps/mcp/src/executor/**`、`docs/design/sheet-outline/**`。
- [ ] Hold the review gate. SL1 and SL2 change an interaction. They wait for the operator's review in chat with screenshots and a video before merge.

### PR mechanics, for every PR

- [ ] Resolve the forge once. Default to `gh`; if `command -v origin` succeeds and Origin can resolve the repository, use `origin pr` for every PR operation. Record any fallback to `gh`. Never require `gt`.
- [ ] Open the PR ready, never draft, per **Opening a PR**. Use the run's built-in PR tool when it has one, else `origin pr create --status open --base <base-branch>` or `gh pr create --base <base-branch>` according to the resolved forge. A stack child targets its parent branch.
- [ ] Run the repo's lint and typecheck once before the PR-facing push. Push with hooks on.
- [ ] Run `/deslop` before each commit and `/no-comments` before review.
- [ ] Triage every Bugbot and security-reviewer comment per `../references/bugbot-triage.md`.
- [ ] Rebase onto current trunk before the code-ready report and babysit. Keep that merge base in fix rounds. Rebase again only at merge prep, on a `git merge-tree` conflict with trunk, on a CI failure that comes from a change on trunk, or when a known concurrent change to the same files lands.
- [ ] PR 标题和提交信息用 Conventional Commits，英文。不对已有文件跑 oxfmt 或仓库级格式化。`pnpm-lock.yaml` 不应变化，变化了就还原。
- [ ] 多个本地委托同时运行时，完成条件是相关测试加 typecheck。未改动文件里的全量测试超时只报告、不阻塞，全量测试以 CI 为准。

### Verdict and merge, for every PR

- [ ] A full swarm runs once, at the code-ready head. Another full swarm runs only for new behavior, a redesign, or a large new diff. A rebase, a merge-conflict resolution, or a minor fix gets a single verifier at the new head, and a wording-only change gets none. Run each full swarm per `pstack/skills/swarm/SKILL.md`. One gates lane. The ten live lanes from the PR's **Verify, live** block. The perf lane from its **Verify, perf** block. Two or more audit lanes, each with its own focus, that read the diff and the receipts and distrust the PR body. The root audits the receipts in the merge-ready report before the verdict.
- [ ] Judge every finding by the execution playbook's blocking rule. The verdict is clean when none blocks. A failure on trunk behavior in a lane marked `Regression lane against trunk.` is recorded against trunk and does not block the PR. A new head gets a fresh verdict, except for results that stay valid under the patch-id rule in `playbooks/shipping.md`.
- [ ] 按 autopilot-stack，每个 PR 在当前 head 验证通过且 CI 为绿时停下，交给操作者。交接后没有操作者同意不再推送。下层出现新 head 时重排上层，`git patch-id` 不变的上层保留原有结论。各层都有结论之前不用 `gh stack link` 关联，避免 `gh stack merge` 带着未验证的上层一起合入。

### Boot recipe, for every live lane

Each live lane runs on its own cloud VM at the PR head. Drive through `control-ui` or `control-cli` from `cursor-team-kit`.

本仓库在 Claude Code 里运行，没有云 VM。每个 lane 用自己的 git worktree 和自己的 verify-uvw 实例代替，CLI 用 verify-uvw 包装的源码版 `uvw` 驱动，MCP 用 `$V mcp` 驱动。

- [ ] `git fetch origin <head-branch> && git checkout <head SHA>`.
- [ ] 在 worktree 根目录执行 `pnpm install --frozen-lockfile` 和 `pnpm --filter 'univer-workspace-cli...' build`。每个 lane 设置自己的 `VERIFY_UVW_ROOT`、`VERIFY_UVW_RUN` 和端口（如 `VERIFY_UVW_RUN=l3 VERIFY_UVW_SERVER_PORT=3963 VERIFY_UVW_WEB_PORT=5963 VERIFY_UVW_MCP_PORT=3973`），先用 `lsof` 确认端口空闲，然后执行 `$V up`、`$V user`、`$V doctor`（SL2 起加 `VERIFY_UVW_MCP=1`），其中 `V=.agents/skills/verify-uvw/bin/verify-uvw`。每次 Bash 调用开头执行 `eval "$($V env)"`。同一时间最多 3 个实例。
- [ ] 用 SL1 新增的 `.agents/skills/verify-uvw/bin/seed-sheets.mjs` 准备数据：导入 `sales-1000.xlsx` 和 `elements.xlsx`，用 `execute` 分批写出 3 万行和 5 万行流水表，打印各 Unit ID。只读诊断是 `$V doctor`、`$EVIDENCE` 下的 `.out`、`.err` 和 `.event.json`。
- [ ] 终端输出用 `$V cli <label> …` 保存。终端截图用 `agent-browser` 打开 `$EVIDENCE/<label>.out` 截取。
- [ ] Save every screenshot to `/tmp/swarm-<pr-id>/worker-<n>/<slug>.png` and return the paths with the report.

## Read Sheet Units through the CLI (SL1)

**Depends on.** None.

**Files.**

- [ ] Create `packages/client-core/src/sheet-lens/**`，从 uxl `ab4070c` 的 `src/lens/**`、`src/engine/display.ts`、`src/engine/types.ts`、`src/platform/cell-error.ts` 复制。
- [ ] Create `packages/client-core/src/sheet-lens/README.md`，写明来源 commit、复制方法、与 uxl 的差异清单。
- [ ] Create `packages/client-core/src/sheet-lens.ts`. Edit `packages/client-core/src/index.ts`.
- [ ] Create `packages/client-core/test/sheet-lens/**`，从 uxl `test/lens/*.test.ts` 和 `test/support/outline-grammar.ts` 移植。
- [ ] Create `apps/cli/src/features/sheet-lens/command.ts`. Edit `apps/cli/src/program.ts`、`apps/cli/src/runtime/daemon.ts`。
- [ ] Edit `apps/cli/README.md` 的命令表。
- [ ] Create `.agents/skills/verify-uvw/bin/seed-sheets.mjs` 和 `.agents/skills/verify-uvw/features/sheet-lens.md`. Edit `.agents/skills/verify-uvw/features/README.md`.

**Build.**

- [ ] 第一个提交只复制 Lens 和测试：import 后缀改为 `.js`，`UxlError` 换成 `WorkspaceApplicationError` 的子类并按设计文档的错误码映射，测试的 `bun:test` 换成 vitest。不改算法。
- [ ] 加边界测试：`sheet-lens/lens/**` 只能 import 本目录文件和 `@univerjs/core` 的类型。
- [ ] 第二个提交实现 `WorkspaceSheetLensEngine`：按设计文档的接口和缓存规则，键含 `caller`，按估算字节淘汰，缓存各表单元格视图供 `read` 和 `find` 复用，透出 Lens 的 `notes` 为警告，统计无缓存值的公式并传给 `buildOutlineModel` 的 `uncached`，非 Sheet 返回 `workspace-sheet-lens-unit-type-unsupported`。
- [ ] 用堆快照测出估算系数：分别缓存 1 千、3 万、5 万行的表后取 `process.memoryUsage().heapUsed` 的增量，除以 UnitData JSON 字节数，结果写进 README。
- [ ] 按测出的系数复核 CLI daemon 512 MB 缓存上限：算出能同时缓存几张 3 万行表，写进 README，并在 SL1 的 merge-ready 报告里向操作者说明是否需要调整。
- [ ] 第三个提交实现 CLI：`outline`、`read`、`find` 三条命令、daemon 方法 `sheet-lens.run`、续读渲染成 `uvw` 命令、`--json` 输出。帮助文本写明只支持 Sheet。`read` 支持 `--styles` 和逐格 `--json`，`find` 支持 `--sheet`。不保留原型的 `--timing` 和 `UVW_LENS_HOST`。
- [ ] `seed-sheets.mjs` 生成并导入原型用过的工作簿：用 `openpyxl` 生成 sales 工作簿，用 `execute` 写流水表。不依赖 uxl 二进制，sales 工作簿的公式由导入后的 `execute` 触发计算。
- [ ] `features/sheet-lens.md` 写出下面 live lane 的命令和通过条件。

**You see.**

- [ ] `$V cli sl1-outline outline --unit $SALES --worktree $W` 的 `$EVIDENCE/sl1-outline.out` 第一行是 `unit <id> [worktree <id>, rev=<n>]`，其后有 `table "OrdersTbl" [ref=s2.t1, A1:J1001, rows=1000, via=table]`。

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `packages/client-core/test/sheet-lens/` 的移植用例全部通过，数量与 uxl `test/lens/` 相同。Run `pnpm --filter @univerjs/univer-workspace-client-core exec vitest run test/sheet-lens`.
- [ ] 引擎用例：同修订第二次调用 `cache` 为 `hit`；修订变化为 `miss`；不同 `caller` 不共享；超过字节上限淘汰最久未用的项；超大单表不入缓存并带警告；非 Sheet 报 `workspace-sheet-lens-unit-type-unsupported`；`too large` 透出为警告；续读结构正确。Run 同上。
- [ ] CLI 用例：帮助文本含 `Sheet only`；续读渲染成带 `--unit` 和 scope 的命令；`--json` 字段齐全。Run `pnpm --filter univer-workspace-cli typecheck && pnpm --filter univer-workspace-cli test`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `sonnet high` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. 在 trunk 和 head 各跑 `inspect workbook` 和 `inspect range A1:C9 --worksheet name:Orders --json`。trunk 没有 `outline`，记录这一点，并在 head 上跑 `outline`。Save `sl1-regression.png`。Pass when 两侧 `inspect` 输出逐字节相同，head 的 `outline` 退出码为 0 且第一行带 `rev=`。
- [ ] Lane 2. 对 sales 工作簿跑整本 `outline` 和 `--at s2.t1`。Save `sl1-zoom.png`。Pass when 输出有 10 个 `col`，Amount 列含 `f=F{r}*G{r} ×1000` 和 `cf="cellIs gt 3000"`，Status 列含 `dv="list: open,shipped,returned"`。
- [ ] Lane 3. 对 sales 工作簿跑 `outline --at s2.t1 --budget 300`，依次执行输出的续读行直到没有续读。Save `sl1-continue.png`。Pass when 第一次输出末尾有 `… N more`，整条续读链列出全部 10 个 `col` ref，各出现一次。预算按单个 scope 计算，整本 `--budget 300` 时 sales 每张表都短于预算，不会出现续读。
- [ ] Lane 4. 对 3 万行表 `read 'Ledger!A1:J200'`，然后执行续读行。Save `sl1-read-page.png`。Pass when 第一页按整行截断并以 `… N more rows: uvw read` 结尾，续读页从下一行开始。
- [ ] Lane 5. 对 sales 工作簿 `read 'Summary!A3:I8' --json`。Save `sl1-read-json.png`。Pass when 每个公式单元格有 `type`、`value`、`display`、`formula`，`value` 是数字而不是显示字符串。
- [ ] Lane 6. `find returned --max 10`，执行续读行，再 `find SUMIFS --in formulas`。Save `sl1-find.png`。Pass when 两页命中合计 61 处且无重复，公式搜索命中 Summary 的 16 个单元格。
- [ ] Lane 7. 对 5 万行表跑 `outline` 和 `--at s1`。Save `sl1-large.png`。Pass when 输出是一个 `block`，紧接一行 `note:` 说明表太大并给出 `read` 和 `find` 的用法，退出码为 0。
- [ ] Lane 8. 对 sales 工作簿跑 `outline --at s2.t1` 两次，用 `execute` 把 `Orders!J2` 改成 `disputed`，再跑一次。Save `sl1-revision.png`。Pass when 前两次 `rev` 相同，第三次 `rev` 加一且 Status 列出现 `disputed`。
- [ ] Lane 9. 对一个 Doc Unit 跑 `outline`，对 sales 工作簿跑 `outline --at s9.t1` 和 `read 'Nope!A1'`。Save `sl1-errors.png`。Pass when 三个命令分别报 `workspace-sheet-lens-unit-type-unsupported`（消息提到 `inspect`）、`workspace-sheet-lens-ref-not-found`、`workspace-sheet-lens-sheet-not-found`，退出码非 0。
- [ ] Lane 10. 把 sales 工作簿合入 trunk 后，用 `--trunk` 跑 `outline` 和 `read`，再用第二个用户（无权限）跑同样的命令。Save `sl1-trunk-acl.png`。Pass when 第一个用户成功且第一行是 `[trunk, rev=…]`，第二个用户得到与 `inspect --trunk` 相同的无权限错误。

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. 热路径下命令耗时的中位数。trunk 和 head 都测 `inspect workbook` 与 `uvw --help`。trunk 没有 `outline`，所以另外单独计 head 上 3 万行表 `outline` 和 `outline --at s1.t1` 的耗时。
- [ ] Probe. trunk 和 head 两个实例交替执行，每项 5 次，先预热一次。两侧都要产出 `inspect workbook` 和 `uvw --help` 的耗时。
- [ ] Baseline. Record the trunk `inspect workbook` 和 `uvw --help` 中位数 first.
- [ ] Rule. head 的 `inspect workbook` 超过 trunk 加 150 ms 即失败。head 上 3 万行表的 `outline` 与 `outline --at s1.t1` 缓存命中时，超过同次测量的 `uvw --help` 加 150 ms 即失败。原型实测分别是 1,346 ms、1,428 ms，`uvw --help` 1,318 ms。

**Review gate.** The operator reviews before merge.

- [ ] Copy lane 2、4、7、9 screenshots into `docs/design/sheet-outline/media/sl1-review-<slug>.png`.
- [ ] 录一段 30 到 60 秒的终端视频，依次执行 lane 2、4、7、9 的命令，保存为 `docs/design/sheet-outline/media/sl1-review.mp4`。lane 2 到 lane 9 的 `.out` 文本汇总成 `docs/design/sheet-outline/media/sl1-review-transcripts.md`。
- [ ] Post the screenshots, the video, and the transcripts in chat. Stop at merge-ready. Wait for the operator's click.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Rebased onto current trunk after the verdict, patch-id unchanged.
- [ ] 停在 merge-ready，交给操作者合入。

## Expose the operations as MCP core tools (SL2)

**Depends on.** SL1.

**Files.**

- [ ] Edit `apps/mcp/src/shared/executor-protocol.ts`.
- [ ] Create `apps/mcp/src/executor/ops/sheet-lens.ts`. Edit `apps/mcp/src/executor/ops/index.ts`、`apps/mcp/src/executor/runtime.ts`。
- [ ] Create `apps/mcp/src/gateway/tools/core/outline.ts`、`read.ts`、`find.ts`. Edit `apps/mcp/src/gateway/tools/registry.ts`、`apps/mcp/src/gateway/instructions.ts`。
- [ ] Create `apps/mcp/test/sheet-lens.test.ts`.
- [ ] Edit `apps/mcp/README.md`、`docs/design/workspace-mcp/tools.zh-CN.md`。
- [ ] Edit `.agents/skills/verify-uvw/features/sheet-lens.md`，加入 MCP 部分。

**Build.**

- [ ] 新增执行器 op `content.sheet-lens`：输入是 scope、unitId 和设计文档的请求联合类型；路由与 `content.inspect` 相同；`effect: "read"`；`rerun: ["auth", "revision"]`；响应上限 1 MiB。执行器持有一个 `WorkspaceSheetLensEngine`，`caller` 用执行器已有的用户标识，缓存上限从环境变量 `EXECUTOR_SHEET_LENS_CACHE_BYTES` 读取。
- [ ] 三个 core 工具共用这个 op，带 `readOnlyAnnotations` 和 `read` scope。描述第一句写明只接受 Sheet Unit，其他类型用 `inspect`，不出现 `uvw`。
- [ ] structured content 返回 `unitId`、`scope`、`revision`、`text`、`json`、`warnings`，续读渲染成 `next: { tool, arguments }`。
- [ ] 用量事件记录 `cache`（hit 或 miss）和阶段耗时。

**You see.**

- [ ] `$V mcp sl2-outline outline '{"unit":"<id>","worktree":"<id>"}'` 的 `$EVIDENCE/sl2-outline.result.json` 里 `text` 第一行带 `rev=`，`.event.json` 的 `outcome` 为 `ok`。

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `apps/mcp/test/sheet-lens.test.ts`：输入 schema 拒绝同时给 `trunk` 和 `worktree`；`next` 渲染成工具参数；非 Sheet 的错误码；不同用户不共享缓存。Run `pnpm --filter @univerjs/univer-workspace-mcp exec vitest run test/sheet-lens.test.ts`.
- [ ] `apps/mcp/test/core-skill.test.ts` 保持通过：工具描述不含 `uvw`。Run `pnpm --filter @univerjs/univer-workspace-mcp typecheck && pnpm --filter @univerjs/univer-workspace-mcp test`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `sonnet high` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. 在 trunk 和 head 各跑 `$V mcp-tools` 和 `$V mcp sl2-inspect inspect '{"target":"workbook",…}'`。Save `sl2-regression.png`。Pass when 两侧 `inspect` 结果相同，head 的工具列表比 trunk 多且只多 `outline`、`read`、`find`。
- [ ] Lane 2. MCP `outline` 与 CLI `outline` 对同一 Unit 同一修订。Save `sl2-parity.png`。Pass when MCP 的 `text` 去掉续读行后与 CLI 输出逐字节相同。
- [ ] Lane 3. MCP `outline` 带小 `budget`，按返回的 `next.arguments` 再调用一次。Save `sl2-next.png`。Pass when `next.tool` 是 `outline`，第二次调用返回剩余节点。
- [ ] Lane 4. MCP `read` 带 `json` 输出读 Summary 汇总块。Save `sl2-read.png`。Pass when 公式单元格的 `value` 是数字。
- [ ] Lane 5. MCP `find` 分页取完 `returned`。Save `sl2-find.png`。Pass when 合计 61 处且无重复。
- [ ] Lane 6. 对 Doc Unit 调 `outline`。Save `sl2-doc.png`。Pass when 返回 `workspace-sheet-lens-unit-type-unsupported`，消息提到 `inspect`，事件 `outcome` 为工具错误。
- [ ] Lane 7. 同一用户连续两次 `outline`，再用第二个有权限的用户调用一次。Save `sl2-cache.png`。Pass when 第一个用户第二次的事件 `cache` 为 `hit`，第二个用户第一次为 `miss`。
- [ ] Lane 8. 浏览器 Agents 会话里列出工具。用 `VERIFY_UVW_MCP_SAME_ORIGIN=1` 启动，在 Agents 页面打开新会话，用 mock provider 让模型调用 `outline`。Save `sl2-agents.png`。Pass when 工具调用卡片显示 `outline` 的输出，且该会话的工具列表在两轮之间不变。
- [ ] Lane 9. 用只读 PAT（`$V mcp-token --scopes read`）调用三个工具。Save `sl2-scope.png`。Pass when 三个调用都成功。
- [ ] Lane 10. 对 5 万行表调用 `outline`。Save `sl2-large.png`。Pass when `warnings` 含表太大的说明，`text` 里有 `note:` 行。

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. 网关事件里的工具耗时中位数。trunk 和 head 都测 `inspect` 的 workbook 目标。trunk 没有 `outline`，所以另外单独计 head 上 3 万行表 `outline` 缓存命中与未命中的耗时。
- [ ] Probe. trunk 和 head 两套实例交替调用，每项 5 次，先预热一次。两侧都要产出 `inspect` 的耗时。
- [ ] Baseline. Record the trunk `inspect` workbook 中位数 first.
- [ ] Rule. head 的 `inspect` 超过 trunk 加 150 ms 即失败。head 上缓存命中的 `outline` 超过 200 ms 即失败。缓存未命中、worker 已热时超过 3,000 ms 即失败。这两个数是预算，原型只测了 CLI，首次测量后在 Appendix A 记录实测值。

**Review gate.** The operator reviews before merge.

- [ ] Copy lane 2、3、6、8 screenshots into `docs/design/sheet-outline/media/sl2-review-<slug>.png`.
- [ ] 录一段 30 到 60 秒的 Agents 会话视频，展示模型先 `outline` 再 `read`，保存为 `docs/design/sheet-outline/media/sl2-review.mp4`。
- [ ] Post the screenshots and the video in chat. Stop at merge-ready. Wait for the operator's click.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Rebased onto current trunk after the verdict, patch-id unchanged.
- [ ] 停在 merge-ready，交给操作者合入。

## Teach agents to read sheets with the new operations (SL3)

**Depends on.** SL2.

**Files.**

- [ ] Edit `apps/cli/skill-data/sheet/SKILL.md`.
- [ ] Create `apps/cli/skill-data/sheet/references/reading.md`.
- [ ] Edit `apps/cli/skill-data/core/SKILL.md`、`apps/mcp/skills/core/SKILL.md`。
- [ ] Edit `apps/mcp/test/core-skill.test.ts`，如需增加断言。

**Build.**

- [ ] 按设计文档「skill 怎么迁移」第 1 到 5 条修改。新增「读一张表」一节，来自 uxl `skills/uxl/SKILL.md` 的 Workflow；`references/reading.md` 来自 uxl `references/reading.md`。两份文件不出现 `uvw`，用「对该 Unit 运行 `outline`，`at` 设为 …」的写法。
- [ ] 改写 sheet skill 的「Reading evidence」和「Verification」：值、类型、公式的验证改用 `read` 的 JSON 输出，`inspect range` 只用于原始 `ICellData`。
- [ ] sheet skill 开头写明三个操作只接受 Sheet Unit。`doc`、`slide`、`base`、`board` skill 不改。
- [ ] CLI `core` skill 和 MCP `core` skill 的命令表加入三个操作，各用本入口的写法。

**You see.**

- [ ] `$V uvw skills get sheet --full` 的输出含「读一张表」一节和 `references/reading.md` 的条目，且不含 `uvw outline`。

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `apps/mcp/test/core-skill.test.ts` 通过：组装后的 skill 不含 `uvw`，只提已注册的工具。Run `pnpm --filter @univerjs/univer-workspace-mcp test`.
- [ ] CLI 的 skill 打包测试通过。Run `pnpm --filter univer-workspace-cli test`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `sonnet high` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. 在 trunk 和 head 各跑 `uvw skills get doc --full`、`slide`、`board`、`base`。Save `sl3-regression.png`。Pass when 四个 skill 两侧逐字节相同。
- [ ] Lane 2. head 上 `uvw skills get sheet --full`。Save `sl3-sheet.png`。Pass when 含「读一张表」一节、续读规则、「不要把一页当整体求和」、`read` JSON 取精确值，且写明只支持 Sheet。
- [ ] Lane 3. `uvw skills read sheet references/reading.md`。Save `sl3-reading.png`。Pass when 文件存在且三个操作的参数与 SL1 的 `--help` 一致。
- [ ] Lane 4. MCP `skills_read` 读 sheet skill。Save `sl3-mcp-skill.png`。Pass when 内容与 CLI 一致且不含 `uvw`。
- [ ] Lane 5. 用 opencode（隔离的 XDG 目录）连接本实例 MCP，让模型回答「Orders 表每列是什么」。Save `sl3-opencode.png`。Pass when 模型的第一个内容工具调用是 `outline`，回答列出 10 列且类型正确。
- [ ] Lane 6. 同上，问「哪些订单是 returned」。Save `sl3-opencode-find.png`。Pass when 模型调用 `find`，若有续读则执行，回答的数量是 60。
- [ ] Lane 7. 同上，问 5 万行流水表的结构。Save `sl3-opencode-large.png`。Pass when 模型看到 `block` 和 `note:` 后改用 `read` 读表头或 `find`，没有把一页当整体。
- [ ] Lane 8. 同上，对 Doc Unit 问结构。Save `sl3-opencode-doc.png`。Pass when 模型使用 `inspect`，或调用 `outline` 收到错误后改用 `inspect`。
- [ ] Lane 9. 用 CLI 驱动的 agent（如 Claude Code 加 `uvw skills install`）做 lane 5 的同一问题。Save `sl3-cli-agent.png`。Pass when 第一个内容命令是 `uvw outline`。
- [ ] Lane 10. 在 sheet skill 的示例里随机选 3 条操作写法，按入口手工执行。Save `sl3-examples.png`。Pass when 3 条都成功。

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. 同一问题（lane 5 的「Orders 表每列是什么」）在 opencode 里完成所用的输入 token 和工具调用次数。trunk 和 head 都可以回答这个问题。
- [ ] Probe. trunk 和 head 交替各跑 3 次，用同一模型 `console-deepseek/deepseek-flash#high` 和同一 MCP 配置。
- [ ] Baseline. Record the trunk 输入 token 中位数和工具调用次数 first.
- [ ] Rule. head 的输入 token 中位数高于 trunk 即失败。这条只防止退步，不宣称具体降幅；降幅数字按可行性研究第 9 节另做同题对照。

**Review gate.** None. SL3 is not review-gated.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Rebased onto current trunk after the verdict, patch-id unchanged.
- [ ] 停在 merge-ready，交给操作者合入。

## Measure and set the large-sheet limit (SL4)

**Depends on.** SL1.

**Files.**

- [ ] Edit `packages/client-core/src/sheet-lens/lens/outline/cells.ts`、`outline/model.ts`、`packages/client-core/src/sheet-lens/README.md`。
- [ ] Edit `packages/client-core/src/sheet-lens.ts`、`apps/cli/src/runtime/daemon.ts`、`apps/mcp/src/executor/runtime.ts`。
- [ ] Create `docs/design/sheet-outline/large-sheets.zh-CN.md`。

**Build.**

- [ ] 把 `cells.ts:330` 的 `500_000` 提成 `buildOutlineModel` 和 `workbookFromData` 的选项 `maxBoxCells`，默认值仍是 50 万。记录到 README 的差异清单。
- [ ] 用 `node --expose-gc` 和堆快照，在 10 万、30 万、50 万、100 万、200 万格的表上测建模时间和常驻堆增量，结果写进 `large-sheets.zh-CN.md`。
- [ ] 按测量结果为 CLI daemon 和 MCP 执行器分别设定 `maxBoxCells`，保证单表常驻内存不超过各自缓存上限的一半。

**You see.**

- [ ] `large-sheets.zh-CN.md` 有一张表，列出每个规模的建模时间、堆增量和最终选择的阈值。

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] 新增用例：`maxBoxCells` 低于外接矩形时输出 `block` 和警告，高于时正常检测。Run `pnpm --filter @univerjs/univer-workspace-client-core exec vitest run test/sheet-lens`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `sonnet high` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. 在 trunk 和 head 对 3 万行表跑 `outline --at s1.t1`。Save `sl4-regression.png`。Pass when 两侧输出逐字节相同。
- [ ] Lane 2. head 上对 5 万行表跑 `outline --at s1`。Save `sl4-50k.png`。Pass when 新阈值高于 50 万时输出 10 列的表，否则输出 `block` 和警告，与 `large-sheets.zh-CN.md` 的结论一致。
- [ ] Lane 3. 一张只有 A1 和 Z20000 两个值的稀疏表。Save `sl4-sparse.png`。Pass when 输出与阈值规则一致且不报错。
- [ ] Lane 4. 刚超过新阈值的表。Save `sl4-over.png`。Pass when 输出 `block` 和警告。
- [ ] Lane 5. 刚低于新阈值的表，连续调用 `outline`、`read`、`find`。Save `sl4-under.png`。Pass when 第二次起 `cache` 为 `hit`，daemon RSS 稳定。
- [ ] Lane 6. 依次缓存三张接近阈值的表。Save `sl4-evict.png`。Pass when 超过缓存上限后最早的项被淘汰，daemon 不崩溃。
- [ ] Lane 7. MCP 执行器上重复 lane 5。Save `sl4-mcp.png`。Pass when 执行器内存不超过容器限制。
- [ ] Lane 8. MCP 执行器上两个用户各读一张大表。Save `sl4-mcp-users.png`。Pass when 两次都成功，缓存按用户隔离。
- [ ] Lane 9. 新阈值下对 sales 工作簿跑整本 `outline`。Save `sl4-small.png`。Pass when 输出与 SL1 相同。
- [ ] Lane 10. 新阈值下对 elements 工作簿跑 `--at s2`。Save `sl4-elements.png`。Pass when 输出与 SL1 相同。

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. 3 万行表 `outline` 缓存未命中时的建模时间，以及新阈值附近的表的建模时间和常驻堆增量。
- [ ] Probe. trunk 和 head 交替各 5 次，worker 已热。
- [ ] Baseline. Record the trunk 3 万行表建模时间 first.
- [ ] Rule. head 的 3 万行表建模时间超过 trunk 的 1.2 倍即失败。新阈值附近的表建模时间超过 5 秒，或常驻堆增量超过缓存上限的一半，即失败。

**Review gate.** None. SL4 is not review-gated.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Rebased onto current trunk after the verdict, patch-id unchanged.
- [ ] 停在 merge-ready，交给操作者合入。

## Close the program

- [ ] Every box above is checked with its evidence.
- [ ] Reply to the operator with the report the execution playbook names.
- [ ] 把 Appendix A 的实测值和未证实项补齐，并检查 `DREAMNUM.md` 是否需要记录从 uxl 复制的 Lens。

## Appendix A. Prototype evidence

原型在分支 `proto/sheet-lens-a2`（提交 `6f6b2ea5`，基于 `b7c49917`），测量脚本和结果在 [prototype-kit/](./prototype-kit/)。证据：

- [原型报告](./prototype.zh-CN.md) 和 [前后对比页](./prototype-compare.html)。
- 与 uxl 的输出比较：12 个视图中 10 个逐字节相同，另外 2 个是 Workspace 导入时重算了一个缓存值过时的 `SUBTOTAL`。
- A1 与 A2 的耗时：3 万行表 `outline` 3,681 ms 对 1,346 ms，5 万行表 5,709 ms 对 1,356 ms，`uvw --help` 1,318 ms，各 5 次中位数。
- 修订变化后缓存失效并读到新值。
- 50 万阈值调到 800 万后，5 万行表输出完整的表格，建模 1.15 秒。

未证实：

- 每格常驻内存。RSS 受 GC 影响，峰值约 700 MB，需要 SL1 和 SL4 用堆快照测定。
- MCP 执行器上的耗时。原型只测了 CLI。
- token 降幅。原型只测了单次调用的输出大小，没有做同题 Agent 对照。

## Appendix B. Alternatives rejected

- **A1：Lens 在 CLI 进程。** 每次调用要把整本 UnitData 从 worker 搬到 CLI，3 万行表单是 `export` 就要约 1.1 秒。
- **在 worker 里执行 Lens。** worker 由 SDK 定义，只开放 `execute` 和 `exportUnitData`，要每次把约 5k 行代码作为脚本传进去。
- **推到 univer-cli-sdk 作为新的 inspection 查询。** 归属更正，但要等 SDK 发版。可以在格式稳定后再做。
- **新建私有包放 Lens。** 要多改 CLI 打包和 MCP 镜像两条链路。放在 client-core 子目录，用边界测试保持纯净。
- **命令加 `sheet` 前缀。** 其他类型接入后会出现两套动词。用通用动词按类型分派。
- **移除或弃用 `inspect`。** 它是 Doc、Slide、Base、Board 唯一的结构化读取方式。
- **服务端保存 ref 表。** MCP 执行器多副本不共享状态，浏览器 Agents 要求提示前缀不变。用由内容决定的 ref 加修订戳。

## Appendix C. Risks

- **缓存内存。** 估算系数不准会让 daemon 或执行器内存过高。SL1 先测系数，SL4 再调阈值，执行器上限可用环境变量覆盖。
- **复制代码与 uxl 分叉。** `sheet-lens/README.md` 记录来源 commit 和差异清单，同步时整目录复制再重放差异（SL1、SL4）。
- **工具列表变化影响浏览器 Agents 的提示缓存。** 新工具只影响新会话。执行器能力发现会让依赖执行器的工具在会话边界出现或消失，SL2 lane 8 检查同一会话内工具列表不变。
- **共享 skill 里的入口写法。** 写入 `uvw` 会让 MCP 的 skill 测试失败，SL3 用中性写法。
- **本机资源。** 每个 live lane 启动一套 verify-uvw，SL2 起还有 Docker 里的 MCP。同时超过 3 套会让测试超时。
- **端口冲突。** 默认端口可能被其他会话的实例占用。每个 lane 使用自己的 `VERIFY_UVW_ROOT`、`VERIFY_UVW_RUN` 和端口。
- **导入请求体上限。** `uvw import` 导入 2,000 行的 xlsx 返回 500（`PayloadTooLargeError`），`seed-sheets.mjs` 只导入 1,000 行的工作簿，大表用 `execute` 写。这个问题单独开 issue，不在本计划修复。
- **合入方式。** `gh stack merge` 曾带着未验证的上层一起合入。所以本计划只到 merge-ready，各层都有结论后才关联 stack。

## Appendix D. Links and reading list

- 设计：[design.zh-CN.md](./design.zh-CN.md)。原型：[prototype.zh-CN.md](./prototype.zh-CN.md)。可行性研究：[feasibility.zh-CN.md](./feasibility.zh-CN.md)。
- uxl：`skills/uxl/SKILL.md`、`references/reading.md`、`src/lens/`、`test/lens/`。
- 改动前必读：根 `AGENTS.md`，`apps/cli/AGENTS.md`，`apps/mcp/AGENTS.md`，`.agents/skills/verify-uvw/SKILL.md`。
- SL2 的执行器 op 涉及多用户缓存，合入前用 pstack 的 `interrogate` 技能做一轮对抗审查。
- 决策记录按 pstack 的 `show-me-your-work` 技能保存在执行者本地，不提交。
