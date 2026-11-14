# Workspace Agents trajectory plan

调试浏览器 Agents 的人打开 Debug mode 后，可以在会话页看到模型实际收到的每一次请求、每条消息、每个工具结果和每一步耗时。
本计划把 [agent-trajectory.md](./agent-trajectory.md) 的设计拆成两个 PR，按 stack 交付。
贯穿全程的规则是按发送形态展示。界面只展示 provider 请求体里的内容，不从 `UIMessage` 重建。
PR 顺序是 TR1（记录每次模型请求）、TR2（Debug mode 开关和 Trajectory 视图）。

## How to read this

One box is one unit of work. Every box names the evidence that checks it. A nested box is a sub-step of the box above it. Check a box only when its evidence exists, a file, a log line, a screenshot, a test run, or a SHA. The body is a how-to. The appendices explain and record.

The program runs `pstack/skills/poteto-mode/playbooks/autopilot-stack.md`. 执行者只构建和验证，不合入。TR1 和 TR2 都停在 merge-ready，由操作者合入。

本计划的 trunk 是 `feat-trajectory` 分支，不是 `main`。TR1 的 PR 以 `feat-trajectory` 为 base，TR2 以 TR1 分支为 base。下文的「trunk」「rebase onto current trunk」和 Regression lane 都指 `feat-trajectory`。两个 PR 都充分验证并由操作者合入 `feat-trajectory` 后，才由操作者把 `feat-trajectory` 整体合入 `main`。任何人不得直接合入或推送 `main`。

在 Herdr 里且装有 Codex 时，代码编写和验证委托按 `~/.claude/rules/pstack-codex-delegation.md` 交给 Codex，其余角色用 pstack 自己的子 agent。

Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

## Program checklist

### Arm the program

- [ ] State the protocol and this plan to the operator, then stop. Start execution only on the operator's explicit go.
- [ ] Read these from trunk at program start. Re-read them at every tick.
  - [ ] `git show origin/feat-trajectory:apps/workspace/docs/proposals/agent-trajectory-plan.md`，本计划。pstack playbook 不在本仓库，从本机插件目录读取 `pstack/skills/poteto-mode/playbooks/autopilot-stack.md`。
  - [ ] 本机插件目录的 `pstack/skills/swarm/SKILL.md`。
  - [ ] `git show origin/main:AGENTS.md`，仓库规则。
  - [ ] `git show origin/feat-trajectory:.agents/skills/verify-uvw/SKILL.md`，浏览器的控制方式和 mock provider 用法。浏览器操作用 `agent-browser`。
  - [ ] 本机插件目录的 `pstack/skills/poteto-mode/playbooks/opening-a-pr.md`。
  - [ ] `git show origin/feat-trajectory:apps/workspace/docs/proposals/agent-trajectory.md`，设计和全部类型。
- [ ] On the operator's go, arm the audit tick as `/loop 1h` with the tick prompt below. Never leave the cadence to memory.
- [ ] Use this tick prompt, verbatim. "Re-read the execution playbook from trunk. Audit the operation against it and fix drift in this tick. Probe every active lane and judge progress by side effects only. Stand down a stuck lane and dispatch its replacement now. Then post a short status message to the operator in chat only when the audit found a tracked change that no earlier status message reported, such as a PR opened, a code-ready head, a round launched or closed, a verdict, a merge, a stuck agent and the action taken, a blocker added or cleared, or a decision only the operator can make. Name every such change and nothing else. Do not repeat a table, the merged list, or an unchanged blocker. If the audit found none, end the turn with no reply text. Either way, log this tick's row in your decision trail. The row names the items reported, or none."
- [ ] On the operator's hold or stand-down, send every owner a zero-writes order at once.

### Spawn owners

- [ ] Spawn one owner per PR with the full lifecycle the execution playbook names.
- [ ] Follow this dependency graph. Start dependent work only after its parent merges, or base it on the parent branch when the execution playbook stacks.
  - [ ] TR1 is first. It branches from `feat-trajectory`.
  - [ ] TR2 after TR1. TR2 branches from the TR1 branch.
- [ ] Hold the file boundaries. TR1 touches only `apps/workspace/web/src/features/agents/{database.ts,database.test.ts,stores.ts,trajectory/**,runtime/**,ui/client.ts}`, `apps/workspace/docs/**`, `DREAMNUM.md` and `.agents/skills/verify-uvw/**`. TR2 touches only `apps/workspace/web/src/features/agents/{trajectory/**,ui/**}`, `apps/workspace/web/src/shared/{debug-mode.ts,i18n.tsx}`, `apps/workspace/web/src/features/account/app-settings-dialog.tsx`, `apps/workspace/docs/**`, `AGENTS.md` and `.agents/skills/verify-uvw/**`.
- [ ] Hold the review gate. TR2 changes an interaction. It waits for the operator's review in chat with screenshots and a video before merge.

### PR mechanics, for every PR

- [ ] Resolve the forge once. Default to `gh`; if `command -v origin` succeeds and Origin can resolve the repository, use `origin pr` for every PR operation. Record any fallback to `gh`. Never require `gt`.
- [ ] Open the PR ready, never draft, per **Opening a PR**. Use the run's built-in PR tool when it has one, else `origin pr create --status open --base <base-branch>` or `gh pr create --base <base-branch>` according to the resolved forge. A stack child targets its parent branch.
- [ ] Run the repo's lint and typecheck once before the PR-facing push. Push with hooks on.
- [ ] Run `/deslop` before each commit and `/no-comments` before review.
- [ ] Triage every Bugbot and security-reviewer comment per `../references/bugbot-triage.md`.
- [ ] Rebase onto current trunk before the code-ready report and babysit. Keep that merge base in fix rounds. Rebase again only at merge prep, on a `git merge-tree` conflict with trunk, on a CI failure that comes from a change on trunk, or when a known concurrent change to the same files lands.
- [ ] PR 标题和提交信息用 Conventional Commits，英文。不对已有文件跑 oxfmt 或仓库级格式化。两个 PR 都不加依赖，`pnpm-lock.yaml` 不应变化，变化了就还原。
- [ ] 多个本地委托同时运行时，完成条件是相关测试加 typecheck。未改动文件里的全量测试超时只报告、不阻塞，全量测试以 CI 为准。

### Verdict and merge, for every PR

- [ ] A full swarm runs once, at the code-ready head. Another full swarm runs only for new behavior, a redesign, or a large new diff. A rebase, a merge-conflict resolution, or a minor fix gets a single verifier at the new head, and a wording-only change gets none. Run each full swarm per `pstack/skills/swarm/SKILL.md`. One gates lane. The ten live lanes from the PR's **Verify, live** block. The perf lane from its **Verify, perf** block. Two or more audit lanes, each with its own focus, that read the diff and the receipts and distrust the PR body. The root audits the receipts in the merge-ready report before the verdict.
- [ ] Judge every finding by the execution playbook's blocking rule. The verdict is clean when none blocks. A failure on trunk behavior in a lane marked `Regression lane against trunk.` is recorded against trunk and does not block the PR. A new head gets a fresh verdict, except for results that stay valid under the patch-id rule in `playbooks/shipping.md`.
- [ ] 按 autopilot-stack，每个 PR 在当前 head 验证通过且 CI 为绿时停下，交给操作者。交接后没有操作者同意不再推送。TR1 出现新 head 时重排 TR2，`git patch-id` 不变时 TR2 保留原有结论。两层都有结论之前不用 `gh stack link` 关联，避免 `gh stack merge` 带着未验证的上层一起合入。

### Boot recipe, for every live lane

Each live lane runs on its own cloud VM at the PR head. Drive through `control-ui` or `control-cli` from `cursor-team-kit`.

本仓库在 Claude Code 里运行，没有云 VM。每个 lane 用自己的 git worktree 和自己的 verify-uvw 实例代替，浏览器用 `agent-browser` 驱动。

- [ ] `git fetch origin <head-branch> && git checkout <head SHA>`.
- [ ] 在 worktree 根目录执行 `pnpm install --frozen-lockfile`。每个 lane 设置自己的 `VERIFY_UVW_RUN` 和三个端口（如 `VERIFY_UVW_RUN=t3 VERIFY_UVW_SERVER_PORT=3923 VERIFY_UVW_WEB_PORT=5976 VERIFY_UVW_MCP_PORT=3933`），然后执行 `VERIFY_UVW_MCP=1 VERIFY_UVW_MCP_SAME_ORIGIN=1 $V up`、`$V user`、`$V doctor`，其中 `V=.agents/skills/verify-uvw/bin/verify-uvw`。每次 Bash 调用开头执行 `eval "$($V env)"`。同一时间最多 3 个实例。
- [ ] 按 verify-uvw 的「Browser Agent mock model」启动 mock provider，每个 lane 用自己的端口、脚本和请求日志，在 Model settings 里加 OpenAI-compatible provider。需要真实 Sheet 的 lane 先用 `.agents/skills/verify-uvw/bin/seed-sheets.mjs` 准备数据。
- [ ] 只用 verify-uvw、mock provider 和 `agent-browser` 的命令输入。只读诊断是 `$V doctor`、`$EVIDENCE` 下的文件、mock provider 的请求日志，以及 TR1 新增的 `.agents/skills/verify-uvw/bin/trajectory-dump.js`（在页面里用 `agent-browser eval` 运行，输出该会话展开后的全部请求）。
- [ ] Save every screenshot to `/tmp/swarm-<pr-id>/worker-<n>/<slug>.png` and return the paths with the report.

## Record each model request as sent (TR1)

**Depends on.** None.

**Files.**

- [ ] Edit `apps/workspace/web/src/features/agents/database.ts` and `database.test.ts`.
- [ ] Create `apps/workspace/web/src/features/agents/trajectory/record.ts` and `record.test.ts`.
- [ ] Create `apps/workspace/web/src/features/agents/trajectory/store.ts`.
- [ ] Create `apps/workspace/web/src/features/agents/trajectory/recorder.ts`.
- [ ] Edit `apps/workspace/web/src/features/agents/stores.ts`、`ui/client.ts`、`runtime/runner.ts` and `runtime/runner.test.ts`.
- [ ] Edit `.agents/skills/verify-uvw/bin/mock-provider.mjs`、`mock-provider.test.mjs` and `SKILL.md`. Create `.agents/skills/verify-uvw/bin/trajectory-dump.js`.
- [ ] Edit `apps/workspace/docs/architecture.md` and `DREAMNUM.md`.

**Build.**

- [ ] 在 `database.ts` 抽出 `openIndexedDatabase(factory, locks, name, stores)`，`openAgentDatabase` 改为调用它，行为不变。`request` 的 store 名参数从固定联合改为由 `stores` 推出的类型。
- [ ] 在 `record.ts` 定义设计文档「记录的类型」里的 `ModelCallRecord`、`RequestDelta` 和它们的 zod schema，实现 `encodeRequest(previous, body)` 和 `expandRequests(records)`。`encodeRequest` 编码后立即展开并与 `body` 比较，不一致时返回 `{ kind: "raw", body }`。`expandRequests` 对每条记录给出完整请求体字符串、解析后的请求、`base`、是否 rewrite、`rest` 是否变化。
- [ ] 在 `store.ts` 实现 `createTrajectoryStore({ userId, indexedDB, locks })`，数据库名 `univer-workspace-agent-trajectory-<userId>`，store `modelCalls`，keyPath `["sessionId", "seq"]`。方法是 `put(record)` 和 `list(sessionId)`。`list` 在边界用 zod 解析，解析失败的记录跳过，并在返回值里给出跳过条数。`stores.ts` 导出它，`ui/client.ts` 创建它并传给 runner。
- [ ] 在 `recorder.ts` 实现 `createCallRecorder({ sessionId, store, redact, previous })`。它返回包装后的 `fetch` 和一组 `ToolLoopAgent` 回调（`onStepStart`、`onLanguageModelCallStart`、`onLanguageModelCallEnd`、`onStepError`、`onToolExecutionStart`、`onToolExecutionEnd`），以及 run 结束时调用的 `finish()`。按设计文档「请求体从 provider fetch 捕获」的表格写记录。写入失败只 `console.error`，不抛出。
- [ ] 在 `runner.ts` 的 `drive` 里，run 开始时用 `store.list` 和 `expandRequests` 取得上一次完整请求，创建记录器。把记录器的 `fetch` 传给 `createModel`，把回调合并进 `ToolLoopAgent` 的选项（保留现有 `onStepEnd` 的 `cacheUsage` 逻辑），在 `finally` 里调用 `finish()`。`redact` 用当前 provider key 做与 `redactMessages` 相同的替换。
- [ ] `session.toolTimings` 改由 `onToolExecutionStart` 和 `onToolExecutionEnd` 写入，删除 `snapshot()` 里按 part 出现时间写 `toolTimings` 的代码。`snapshot()` 仍负责 worktree 提取和持久化。
- [ ] mock provider 的脚本步骤增加两种形状。`{"error":{"status":500,"body":"..."}}` 返回该状态码和正文。`{"tools":[{...},{...}]}` 在一次回复里返回多个并行工具调用。`mock-provider.test.mjs` 覆盖这两种形状，`SKILL.md` 的「Browser Agent mock model」写明用法。
- [ ] `trajectory-dump.js` 是给 `agent-browser eval` 用的页面脚本。它在 Vite dev 页面里动态导入 `/src/features/agents/trajectory/store.ts` 和 `record.ts`，读出 `location.pathname` 对应会话的记录并展开，打印 JSON 数组，每项含 `seq`、`outcome`、`attempts`、`base`、`rewrite` 和完整请求体字符串。
- [ ] `architecture.md` 在 Agents 的 `modelSnapshot` 段落后加一段，说明模型请求记录的位置、增量编码和 rewrite 含义。`DREAMNUM.md` 第 165 行起的 Browser Agents 数据说明加上「模型请求记录」，写明它和会话记录一样只在浏览器 IndexedDB 里，不含 key。

**You see.**

- [ ] 对 mock provider 跑完一轮两步对话后，`agent-browser eval "$(cat .agents/skills/verify-uvw/bin/trajectory-dump.js)"` 打印两条记录，`outcome.kind` 都是 `ok`，第二条的 `base` 等于第一条请求的消息数，每条的请求体字符串与 mock 请求日志里对应行的 `body` 逐字相同。

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `trajectory/record.test.ts` 覆盖这些情况：首次请求整体保存；只追加时 `base` 等于上一次条数，`rest` 省略；历史中间改写时 `base` 变小并标 rewrite；`rest` 变化时保存新 `rest`；非 JSON 或无 `messages` 的正文存为 `raw`；任意编码结果展开后与原字符串逐字相同。Run `pnpm --filter @univerjs/univer-workspace test web/src/features/agents/trajectory/record.test.ts`.
- [ ] `runtime/runner.test.ts` 新增用例，都基于现有离线 fetch 和真实 SDK。每次调用展开后的请求体与离线 fetch 收到的 `init.body` 逐字相同；两轮对话没有 rewrite；第一次 500、重试成功时只有一条记录、两次 attempt，第一次带状态码和错误正文；持续失败时记录为 `error`，会话为 `failed`；中途停止时记录为 `aborted`；消息里出现 provider key 时记录里是 `[redacted]`；`toolTimings[id].startedAt` 不早于对应调用的 `endedAt`；记录写入抛错时会话照常完成。Run `pnpm --filter @univerjs/univer-workspace test web/src/features/agents/runtime/runner.test.ts`.
- [ ] `database.test.ts` 新增用例，确认抽出 `openIndexedDatabase` 后现有三个 store 的读写不变，trajectory 数据库与 agents 数据库互不影响。Run `pnpm --filter @univerjs/univer-workspace test web/src/features/agents/database.test.ts`.
- [ ] Run `node --test .agents/skills/verify-uvw/bin/mock-provider.test.mjs`.
- [ ] Run `pnpm --filter @univerjs/univer-workspace typecheck` and `pnpm --filter @univerjs/univer-workspace build:web`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `sonnet high` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. 在 trunk 和 head 用同一个 mock 脚本跑同一段两轮对话（第一轮一个 `repo_list` 工具调用加一段文本，第二轮一段文本）。trunk 没有记录功能，记录这一点。Save `tr1-regression.png`。Pass when 两侧会话都正常结束，两侧 mock 日志里每个 `POST /chat/completions` 的 `body` 逐字相同，说明记录没有改变发送内容。
- [ ] Lane 2. 在 head 跑 Lane 1 的对话后运行 `trajectory-dump.js`。Save `tr1-exact.png`，内容是 dump 与 mock 日志逐项比较的终端截图。Pass when 记录条数等于请求条数，每条展开后的请求体与 mock 日志的 `body` 逐字相同。
- [ ] Lane 3. 三轮对话，第二轮在仓库作用域附带一个 reference，第三轮切换到 Ask 模式。Save `tr1-delta.png`。Pass when 每次调用的 `base` 等于上一次请求的消息数，`rewrite` 全为 false，第三轮第一条记录的 `rest` 没有变化，system-reminder 只出现在对应用户消息里。
- [ ] Lane 4. mock 步骤设 `delayMs: 8000`，运行中输入一条引导消息。Save `tr1-steer.png`。Pass when 引导消息出现在某条记录新增的消息里，角色为 `user`，没有 rewrite，会话正常结束。
- [ ] Lane 5. mock 脚本先给一个 `{"error":{"status":500,"body":"overloaded"}}` 步骤，再给正常步骤。Save `tr1-retry.png`。Pass when 该调用只有一条记录，`attempts` 有两项，第一项 `status` 为 500 且 `errorBody` 为 `overloaded`，`outcome.kind` 为 `ok`。
- [ ] Lane 6. mock 脚本连续给出足够多的 500 步骤让调用失败，再发一条新消息并让它成功。Save `tr1-failure.png`。Pass when 失败调用的 `outcome.kind` 为 `error`，会话显示失败，新消息的第一条记录的 `base` 包含失败调用发出的全部消息。
- [ ] Lane 7. mock 步骤设 `delayMs: 15000`，流式期间点击停止。Save `tr1-abort.png`。Pass when 该调用的 `outcome.kind` 为 `aborted`，`endedAt` 不为空，会话状态为 Stopped，之后再发消息能正常运行。
- [ ] Lane 8. mock 脚本给一个 `{"tools":[...]}` 步骤并行调用 `repo_list` 和 `search`。Save `tr1-tools.png`，内容是会话页步骤列表加 dump 截图。Pass when 两个工具的 `toolTimings.startedAt` 都不早于该调用的 `endedAt`，会话页两个工具步骤都显示耗时。
- [ ] Lane 9. 走一次页面草稿审批（`html_view_create`，按 verify-uvw 的 HTML View 草稿流程），批准后继续运行。Save `tr1-approval.png`。Pass when 审批前后的记录 `seq` 连续，每条展开后的请求体与 mock 日志逐字相同。审批恢复如果产生 rewrite，把出现位置记进 Appendix A，不判失败。
- [ ] Lane 10. 在用户消息里粘贴 provider key 文本 `mock-key`，运行后刷新页面再发第二条消息。Save `tr1-redact.png`。Pass when mock 日志里的请求含 `mock-key`，记录里同一位置是 `[redacted]`，刷新后第二条消息的记录 `seq` 接着上一条，`base` 不为 0。

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. 同一 run 内相邻两次模型请求到达 mock 的时间差，用 mock 日志的 `arrivedAt` 计算。场景是 20 步的工具调用脚本（每步一个 `repo_list`），trunk 和 head 都能跑。trunk 没有记录功能，所以另外在 head 上计记录的存储量，即 trajectory 数据库里该会话全部记录的 JSON 字节数与会话记录 JSON 字节数之比。
- [ ] Probe. trunk 和 head 两个实例交替跑同一脚本，各 5 次，先 trunk 后 head 轮流。两侧都要产出 19 个时间差。
- [ ] Baseline. Record the trunk 时间差中位数 first.
- [ ] Rule. head 时间差中位数超过 trunk 中位数加 30 ms 即失败。存储量之比超过 1.5 即失败。这两个数是预算，不是实测，首次测量后在 Appendix A 记录实测值。

**Review gate.** None. TR1 is not review-gated.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Rebased onto current trunk after the verdict, patch-id unchanged.
- [ ] 停在 merge-ready，交给操作者合入。

## Show the trajectory in debug mode (TR2)

**Depends on.** TR1.

**Files.**

- [ ] Create `apps/workspace/web/src/shared/debug-mode.ts`. Edit `apps/workspace/web/src/shared/i18n.tsx`.
- [ ] Edit `apps/workspace/web/src/features/account/app-settings-dialog.tsx`.
- [ ] Create `apps/workspace/web/src/features/agents/trajectory/build.ts` and `build.test.ts`.
- [ ] Create `apps/workspace/web/src/features/agents/ui/trajectory-view.tsx`、`ui/trajectory-detail.tsx`、`ui/json-view.tsx` and `ui/trajectory.css`.
- [ ] Edit `apps/workspace/web/src/features/agents/ui/session-page.tsx` and `ui/messages.ts`.
- [ ] Create `.agents/skills/verify-uvw/features/agent-trajectory.md`. Edit `.agents/skills/verify-uvw/features/README.md`.
- [ ] Edit `apps/workspace/docs/architecture.md` and the root `AGENTS.md`.

**Build.**

- [ ] 在 `debug-mode.ts` 实现设计文档「Debug mode 开关」的 `useDebugMode`。在 `app-settings-dialog.tsx` 主题行下面加调试模式行，用 `Segmented`。`i18n.tsx` 两种语言都加文案。
- [ ] 在 `build.ts` 实现设计文档「构建 trajectory」的 `buildTrajectory` 和类型。来源识别用一张 `ReminderSpan` 来源表，不写分散的条件分支。`WireMessage` 用宽松 zod schema 解析，解析失败的请求在结果里标为 unparsed。
- [ ] 在 `session-page.tsx` 的 `SessionContent` 外层加标签。Debug mode 关闭时不渲染标签，页面与 trunk 相同。打开时显示「对话」和「Trajectory」，Trajectory 标签渲染 `TrajectoryView`，占满宽度，不显示输入框和右侧栏。
- [ ] `TrajectoryView` 用 `@tanstack/react-query` 按会话 id 读取 `trajectoryStore.list`，会话运行中每秒刷新一次。按设计文档「会话页」实现工具栏、四列树、Turn 折叠、只看错误和搜索。
- [ ] `trajectory-detail.tsx` 按设计文档「详情面板」的表格实现每种行的标签页。Context sent 的「复制请求 JSON」复制展开后的原始请求体字符串。MCP result 标签页顶部写明它不是模型收到的内容。
- [ ] `json-view.tsx` 按设计文档「JSON 和长文本」实现树、Raw、复制、默认折叠、长字符串截断和就地解析 JSON 字符串。子节点在展开时才渲染。
- [ ] 界面文案放在 `ui/messages.ts` 两种语言里。角色标签 SYSTEM、USER、ASSISTANT、TOOL 是请求里的角色名，不翻译。
- [ ] `agent-trajectory.md`（verify-uvw feature）写明 Debug mode 的开法、`trajectory-dump.js` 的用法和下面十个 lane 的复现步骤。`architecture.md` 加一段 Trajectory 视图的位置和数据来源。根 `AGENTS.md` 的「Workspace Agents 提示缓存」最后一条加一句，核对缓存命中可以看 Trajectory 的 Context sent 和 history rewrite 计数。

**You see.**

- [ ] 在设置里打开调试模式后，会话页出现「Trajectory」标签。点开后第一行是 SYSTEM，下面是 Turn 1，展开后依次是 USER、ASSISTANT 和缩进的 TOOL 行，ASSISTANT 和 TOOL 行有耗时和瀑布条。

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `trajectory/build.test.ts` 用 TR1 记录形状的 fixture 覆盖这些情况：两轮对话的 Turn 划分和 step 编号；system-reminder 留在用户消息里且来源识别正确；并行工具挂在发起它的 assistant 下；`replay` 取自下一次请求，与 `response` 不一致时标 `replayMismatch`；最后一次调用的工具为 `unsent`；运行中追加的用户消息开启新 Turn；失败调用没有子行；rewrite 和参数变化的计数；无记录时 `unrecorded`；无法解析的请求标为 unparsed。Run `pnpm --filter @univerjs/univer-workspace test web/src/features/agents/trajectory/build.test.ts`.
- [ ] `useDebugMode` 的读取逻辑抽成纯函数并测试，覆盖未设置、`"1"`、非法值和 `localStorage` 抛错。测试放在 `apps/workspace/web/src/shared/debug-mode.test.ts`。Run `pnpm --filter @univerjs/univer-workspace test web/src/shared/debug-mode.test.ts`.
- [ ] Run `pnpm --filter @univerjs/univer-workspace typecheck` and `pnpm --filter @univerjs/univer-workspace build:web`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `sonnet high` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. 在 trunk 和 head 用同一个 mock 脚本跑同一段两轮对话，head 不打开调试模式。trunk 没有调试模式和 Trajectory，记录这一点。Save `tr2-regression.png`，内容是两侧会话页并排截图。Pass when head 会话页没有标签，布局和内容与 trunk 一致，应用设置里多出调试模式一行且默认为关。
- [ ] Lane 2. 在应用设置里打开调试模式，刷新页面，再在第二个标签页打开同一会话，然后在第一个标签页关闭调试模式。Save `tr2-toggle.png`。Pass when 打开后出现「对话」和「Trajectory」标签，刷新后仍打开，关闭后第二个标签页的标签在不刷新的情况下消失。
- [ ] Lane 3. 跑 TR1 Lane 1 的对话后打开 Trajectory。Save `tr2-tree.png`。Pass when 树依次是 SYSTEM、Turn 1、Turn 2，Turn 1 内的 step 编号从 1 连续递增，ASSISTANT 行的耗时和 token 与 `trajectory-dump.js` 的记录一致，TOOL 行缩进在 ASSISTANT 下。
- [ ] Lane 4. 在仓库作用域附带一个 reference 发送消息，点开 USER 行的 As sent。Save `tr2-user.png`。Pass when 用户输入和 system-reminder 在同一条消息里按发送顺序显示，reminder 块标出 References 和 Skill catalog，文字与 mock 日志里该用户消息的 `content` 逐字相同。
- [ ] Lane 5. 用 `seed-sheets.mjs` 准备一个 40 行的 Sheet，mock 脚本调用 `outline`。点开该 TOOL 行。Save `tr2-tool.png`。Pass when As sent 显示模型收到的 tool message，内容里的 JSON 字符串被解析成树，超过 4 KB 的节点默认折叠且能展开，MCP result 标签页显示 `structuredContent` 并写明不是模型收到的内容，Arguments 与 mock 日志里的 `arguments` 一致。
- [ ] Lane 6. 点开第二次调用的 Context sent，再点「复制请求 JSON」，用 `agent-browser eval` 读剪贴板。Save `tr2-context.png`。Pass when 只有本次新增的消息标 NEW，缓存命中条的数字与记录的 `usage` 一致，剪贴板内容与 mock 日志里第二个请求的 `body` 逐字相同。
- [ ] Lane 7. 跑 TR1 Lane 5 和 Lane 6 的失败场景后打开 Trajectory。Save `tr2-errors.png`。Pass when 失败调用的行为红色并写明原因，Usage & timing 列出两次 attempt 及 500 状态和错误正文，「只看错误」只留下出错的 Turn 和行。
- [ ] Lane 8. mock 步骤设 `delayMs: 8000`，运行中停留在 Trajectory 标签。Save `tr2-live.png`。Pass when 正在进行的调用出现并显示增长中的瀑布条，调用结束后不刷新页面就显示耗时和 token，运行中切回「对话」标签能正常追加引导消息。
- [ ] Lane 9. 在 Lane 3 的会话里搜索 `repo_list` 的结果中的一个仓库名，再搜索一个不存在的词。Save `tr2-search.png`。Pass when 第一次只显示包含该名字的行及其上级 Turn 和 ASSISTANT，第二次显示无结果状态，清空搜索后恢复完整树。
- [ ] Lane 10. 按 verify-uvw 的 IndexedDB 准备方法写入一个没有任何 trajectory 记录的会话，再写入一个三次调用且第三次 `base` 小于上一次条数的记录序列。分别打开两个会话的 Trajectory。Save `tr2-unrecorded.png` 和 `tr2-rewrite.png`。Pass when 第一个会话显示没有模型请求记录的说明且「对话」标签正常，第二个会话的工具栏 history rewrite 计数为 1，第三次调用的 Context sent 在改写位置标 REWRITTEN。

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. 两个数。第一个是会话页从刷新到第一条消息可见的时间，调试模式关闭，trunk 和 head 都能测。第二个是 head 上从点击 Trajectory 标签到树的全部行渲染完成的时间，场景是 40 次调用的会话，trunk 没有这个功能。
- [ ] Probe. 第一个数在 trunk 和 head 两个实例上交替测，各 10 次，用 `agent-browser eval` 读 `performance.now()` 和 `MutationObserver` 的时间戳。第二个数在 head 上测 10 次，用同样的方法。
- [ ] Baseline. Record the trunk 刷新到第一条消息可见的中位数 first.
- [ ] Rule. 调试模式关闭时 head 中位数超过 trunk 中位数加 50 ms 即失败。40 次调用的 Trajectory 渲染中位数超过 500 ms 即失败。这两个数是预算，不是实测，首次测量后在 Appendix A 记录实测值。

**Review gate.** The operator reviews before merge.

- [ ] Copy lane 3, 4, 5, 6 and 10 screenshots into `/tmp/swarm-TR2/review/TR2-review-<slug>.png`.
- [ ] Record a 30 to 60 second video of the change on a lane VM. Save it as `/tmp/swarm-TR2/review/TR2-review.mp4`. 本仓库没有云 VM，在 lane 的 verify-uvw 实例上用 `agent-browser` 录制。
- [ ] Post the screenshots and the video in chat. Stop at merge-ready. Wait for the operator's click.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Rebased onto current trunk after the verdict, patch-id unchanged.
- [ ] 停在 merge-ready，交给操作者合入。

## Close the program

- [ ] Every box above is checked with its evidence.
- [ ] Reply to the operator with the report the execution playbook names.
- [ ] 把 Appendix A 的实测性能值和未证实项补齐，把本计划和设计文档里与落地结果不一致的地方改成落地后的事实。
- [ ] 开一个 `feat-trajectory` 到 `main` 的 PR，正文汇总 TR1 和 TR2 的结论和证据，停在 merge-ready，由操作者合入。

## Appendix A. Prototype evidence

原型是一次性代码，放在本机 `/tmp/uvw-trajectory-prototype/`，没有分支和提交。`index.html?debug` 打开，按 1 和 2 切换。截图在 `shots/`，其中 `6-B-tree.png` 和 `7-B-context-sent.png` 是选中的方案 B。`/tmp` 重启后会清空，界面要求以设计文档的文字为准。

原型证明了这些事。

- 四层信息（SYSTEM、Turn、模型调用、工具）放进一棵四列树后，2 个 Turn、10 次调用在一屏内能看清，按 Turn 缩放的瀑布条能直接看出最慢的一步和并行工具。
- 1.5 KB 的工具结果在默认折叠规则下首屏可读，长字符串截断加展开可用。
- Context sent 的 NEW 标记能直接看出两次调用之间追加了什么。

设计阶段读 `ai@7.0.166` 和 `@ai-sdk/provider-utils@5.0.76` 的源码证实了这些事。

- provider 请求体由 `@ai-sdk/provider-utils` 的 `JSON.stringify(body)` 生成（`dist/index.js` 第 3627 行），所以解析后再序列化应与原字节相同。编码时的展开校验仍保留，防止例外情况。
- `onLanguageModelCallStart` 在 `doStream`（即 provider fetch）之前触发（`ai` 的 `dist/index.js` 第 8549 至 8557 行）。
- 重试包在 `streamLanguageModelCall` 外面（第 10097 行），每次重试都再次触发 `onLanguageModelCallStart`。`callId` 在每次 `streamText` 调用时只生成一次（第 9798 行），所以调用边界改用 `onStepStart`。

设计阶段未证实的事项，执行阶段（2026-11-14，mock provider 走真实 SDK）的结果如下。

- 增量编码不退化。每个会话的第一条记录存为 `raw`，之后全部是 `delta`，live lane 累计数百条记录都是这样。第一条存 `raw` 的原因是 provider 把 `messages` 放在请求对象中间，带 `rest` 的展开无法还原键序；参数变化的那一条同理。两种形式存的字节数相同。存储量是会话记录的 1.15 到 1.16 倍。
- 审批后执行的工具和 `gateTools` 包装的发布工具，在浏览器里实测不到。浏览器 Agent 连接的 core 工具集没有 publish 作用域的工具（27 个 read、15 个 write），不会出现审批卡片。runner 测试用真实 SDK 证明，`pr_create` 和带 publish 元数据的 `html_view_create` 审批后都触发 `onToolExecutionStart` 和 `onToolExecutionEnd`。
- 审批恢复是否改写历史，同样只有 runner 测试的证据：审批前后记录 `seq` 连续，展开请求体与发送的逐字相同，没有 rewrite。
- DeepSeek 是否回传 `reasoning_content`，没有测。全部 lane 用的是 OpenAI-compatible mock。

执行中新发现的事实。

- `ai@7.0.166` 只在消费方继续读取流时触发 `onAbort`。引导消息在模型回复中途打断调用时会触发 `onAbort`，记录为 `aborted`。引导消息在 provider 回复之前打断时，SDK 不触发任何结束事件，这条记录会一直停在 `running`。这与设计假设不符，已报告操作者，等待决定。
- 浏览器引导消息无法附带 reference，只有新会话的输入框能附带。TR1 Lane 3 和 TR2 Lane 4 改为在新会话的第一条消息里附带。
- verify-uvw 没有「HTML View 草稿流程」，原因见上面审批一条。

性能实测值（Vite dev，单实例只切换 web 代码，trunk 和 head 交替）。

- TR1 相邻请求间隔，中位数 trunk 26 ms、TR1 25 ms（每侧 10 次、190 个间隔，负载 19 到 24）。早先测得 TR1 慢 17 到 40 ms，原因是工具计时回调里两次 `snapshot()` 让会话页每个工具多重渲染两次。去掉后，间隔与 trunk 相同。
- TR2 调试模式关闭时，刷新到第一条消息可见，三次 dev 测量分别是比 trunk 快 94 ms、慢 171 ms、快 256 ms（最后一次每侧 20 次）。差异落在约 ±250 ms 的噪声内，没有变慢。生产构建的对比因第二个 origin 的 MCP 返回 403 没有测成。
- 40 次调用的 Trajectory 从点击到全部行可见，中位数 dev 143 ms，生产构建 61 ms。改之前分别是 512 ms 和 406 ms，其中约 300 ms 是 React Suspense 的 `FALLBACK_THROTTLE_MS`。现在打开调试模式时就预先加载视图模块，调试模式关闭时不请求。

## Appendix B. Alternatives rejected

- **方案 A（DSH 式平铺时间线）。** 扫读最快，但模型调用和工具没有层级，单次调用的耗时构成和上下文不直观。操作者选了 B。
- **把 system-reminder 画成独立的 CONTEXT 行。** 原型 A 和 B 都这样做。它改变了消息的边界，违反按发送形态展示的规则。改为留在用户消息里，只标来源。
- **从 `UIMessage` 重建请求。** 无需新存储，但重建结果不是发送形态，转换层的问题看不到。改为记录请求体。
- **用 SDK 的 `include: { requestBody: true }` 取请求体。** 失败的步骤拿不到请求体，看不到重试。改为在 provider fetch 捕获。
- **每次保存完整请求体。** 存储随调用次数平方增长。改为增量编码，并用展开校验保证逐字一致。
- **给现有 agents 数据库升版本加 store。** 现有升级逻辑会在已有 store 上报错，旧标签页会挡住新标签页。改为独立数据库。
- **只在 Debug mode 打开时记录。** 用户遇到问题后才打开调试模式时没有数据。改为始终记录，Debug mode 只控制显示。
- **标签状态写进 URL。** 会话页由模式注册表的 `pages.agentSession` 渲染，加搜索参数要改路由和所有模式。没有永久链接的需求，不做。

## Appendix C. Risks

- **请求体里的文档内容。** 记录和会话记录一样包含工具返回的文档内容。TR1 必须同步更新 `DREAMNUM.md` 的数据说明，并保证 key 被替换。
- **存储增长。** 记录没有保留期限。TR1 的存储量预算是会话记录的 1.5 倍，超出时先检查增量编码是否退化成 `raw`。
- **SDK 事件顺序。** 记录器假设同一会话的模型调用串行，每个步骤先触发 `onStepStart`，fetch 发生在 `onLanguageModelCallStart` 之后、`onLanguageModelCallEnd` 或 `onStepError` 之前。SDK 行为不同时，TR1 owner 停下并向操作者报告，不加锁绕过（TR1）。
- **`toolTimings` 语义变化。** 工具在等待审批或流式参数期间不再有计时，会话页显示空值占位符。这是更准确的耗时，但 TR1 owner 要确认会话页没有依赖旧语义的地方（TR1）。
- **提示缓存。** 记录器只读请求，不能改动 `messages` 或系统提示词。TR1 Lane 1 用 trunk 和 head 请求体逐字相同来守住这一点。
- **本机资源和端口。** 每个 live lane 启动一套 verify-uvw 和 mock provider。同时最多 3 套，每个 lane 使用自己的 `VERIFY_UVW_RUN`、端口和 mock 日志。
- **合入方式。** auto-mode 分类器曾拒绝合入操作，`gh stack merge` 曾带着未验证的上层一起合入。所以本计划只到 merge-ready，两层都有结论后才关联 stack。

## Appendix D. Links and reading list

- 设计：[agent-trajectory.md](./agent-trajectory.md)。
- 改动前必读：根 `AGENTS.md` 的「Workspace Agents 提示缓存」，`apps/workspace/AGENTS.md`，`.agents/skills/verify-uvw/SKILL.md` 的「Browser Agent mock model」，`apps/workspace/web/src/features/agents/runtime/runner.ts` 的 `drive` 和 `snapshot`。
- 本仓库的 `node_modules` 里 `ai` 是 7.0.166。TR1 owner 先读 `ai/dist/index.d.ts` 里 `ToolLoopAgentSettings`、`LanguageModelCallStartEvent`、`LanguageModelCallEndEvent` 和 `ToolExecutionStartEvent` 的定义，再写记录器。
- TR1 的记录器跨 runner、model 和存储三处，实现前用 pstack 的 `how` 技能确认 `drive` 的调用路径。TR1 涉及提示缓存不变量，合入前用 pstack 的 `interrogate` 技能做一轮对抗审查。
- 决策记录按 pstack 的 `show-me-your-work` 技能保存在执行者本地，不提交。
