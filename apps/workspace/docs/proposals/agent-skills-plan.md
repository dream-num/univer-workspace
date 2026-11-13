# Workspace Agents skill plan

Workspace Agents 的用户和仓库维护者可以把做法写进 `.agents/skills/<name>/SKILL.md`，agent 平时只看名字和描述，需要时才读正文，用户也能用 `/name` 直接调用。
本计划把 [agent-skills.md](./agent-skills.md) 的设计和 [agent-skills-architecture.md](./agent-skills-architecture.md) 的架构拆成三个 PR，按 stack 交付。
贯穿全程的规则是同一会话内系统提示词逐字不变，历史只追加，非成员仓库的 skill 不加载。
PR 顺序是 SK1（gateway 发现和 `skills_read`）、SK2（浏览器目录、右侧栏和 mock provider）、SK3（`/` 显式调用）。

## How to read this

One box is one unit of work. Every box names the evidence that checks it. A nested box is a sub-step of the box above it. Check a box only when its evidence exists, a file, a log line, a screenshot, a test run, or a SHA. The body is a how-to. The appendices explain and record.

The program runs `pstack/skills/poteto-mode/playbooks/autopilot-stack.md`. 执行者只构建和验证，不合入。SK1、SK2、SK3 都停在 merge-ready，由操作者合入。

在 Herdr 里且装有 Codex 时，代码编写和验证委托按 `~/.claude/rules/pstack-codex-delegation.md` 交给 Codex，其余角色用 pstack 自己的子 agent。

Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

## Program checklist

### Arm the program

- [ ] State the protocol and this plan to the operator, then stop. Start execution only on the operator's explicit go.
- [ ] Read these from trunk at program start. Re-read them at every tick.
  - [ ] `git show origin/main:apps/workspace/docs/proposals/agent-skills-plan.md`，本计划。pstack playbook 不在本仓库，从本机插件目录读取 `pstack/skills/poteto-mode/playbooks/autopilot-stack.md` 和 `autopilot-full.md`。
  - [ ] 本机插件目录的 `pstack/skills/swarm/SKILL.md`。
  - [ ] `git show origin/main:.agents/skills/verify-uvw/SKILL.md`，浏览器和 CLI 的控制方式。浏览器操作用 `agent-browser`。
  - [ ] 本机插件目录的 `pstack/skills/poteto-mode/playbooks/opening-a-pr.md`。
  - [ ] `git show origin/main:apps/workspace/docs/proposals/agent-skills.md` 和 `git show origin/main:apps/workspace/docs/proposals/agent-skills-architecture.md`。
- [ ] On the operator's go, arm the audit tick as `/loop 1h` with the tick prompt below. Never leave the cadence to memory.
- [ ] Use this tick prompt, verbatim. "Re-read the execution playbook from trunk. Audit the operation against it and fix drift in this tick. Probe every active lane and judge progress by side effects only. Stand down a stuck lane and dispatch its replacement now. Then post a short status message to the operator in chat only when the audit found a tracked change that no earlier status message reported, such as a PR opened, a code-ready head, a round launched or closed, a verdict, a merge, a stuck agent and the action taken, a blocker added or cleared, or a decision only the operator can make. Name every such change and nothing else. Do not repeat a table, the merged list, or an unchanged blocker. If the audit found none, end the turn with no reply text. Either way, log this tick's row in your decision trail. The row names the items reported, or none."
- [ ] On the operator's hold or stand-down, send every owner a zero-writes order at once.

### Spawn owners

- [ ] Spawn one owner per PR with the full lifecycle the execution playbook names.
- [ ] Follow this dependency graph. Start dependent work only after its parent merges, or base it on the parent branch when the execution playbook stacks.
  - [ ] SK1 is first. It branches from `main`.
  - [ ] SK2 after SK1. SK2 branches from the SK1 branch.
  - [ ] SK3 after SK2. SK3 branches from the SK2 branch.
- [ ] Hold the file boundaries. SK1 touches only `apps/mcp/**`, `docs/design/workspace-mcp/**`, and `.agents/skills/verify-uvw/**`. SK2 and SK3 touch only `apps/workspace/web/src/features/agents/**`, `apps/workspace/docs/**`, and `.agents/skills/verify-uvw/**`.
- [ ] Hold the review gate. SK2 and SK3 change an interaction. They wait for the operator's review in chat with screenshots and a video before merge.

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

本仓库在 Claude Code 里运行，没有云 VM。每个 lane 用自己的 git worktree 和自己的 verify-uvw 实例代替，浏览器用 `agent-browser` 驱动，CLI 用 verify-uvw 包装的源码版 `uvw` 驱动。

- [ ] `git fetch origin <head-branch> && git checkout <head SHA>`.
- [ ] 在 worktree 根目录执行 `pnpm install --frozen-lockfile`。每个 lane 设置自己的 `VERIFY_UVW_RUN` 和三个端口（如 `VERIFY_UVW_RUN=l3 VERIFY_UVW_SERVER_PORT=3923 VERIFY_UVW_WEB_PORT=5976 VERIFY_UVW_MCP_PORT=3933`），然后执行 `VERIFY_UVW_MCP=1 VERIFY_UVW_MCP_SAME_ORIGIN=1 $V up`、`$V user`、`$V doctor`，其中 `V=.agents/skills/verify-uvw/bin/verify-uvw`。每次 Bash 调用开头执行 `eval "$($V env)"`。同一时间最多 3 个实例。
- [ ] 只用 verify-uvw 和 `agent-browser` 的命令输入。只读诊断是 `$V doctor`、`$EVIDENCE` 下的 `.out` 和 `.event.json`、mock provider 的请求日志。准备 skill 用 SK1 新增的 `.agents/skills/verify-uvw/bin/seed-skills.mjs`。
- [ ] Save every screenshot to `/tmp/swarm-<pr-id>/worker-<n>/<slug>.png` and return the paths with the report.

## Discover custom skills in the gateway (SK1)

**Depends on.** None.

**Files.**

- [ ] Create `apps/mcp/src/gateway/custom-skills.ts`.
- [ ] Edit `apps/mcp/src/gateway/tools/core/skills-read.ts`.
- [ ] Edit `apps/mcp/test/reference-tools.test.ts`.
- [ ] Edit `apps/mcp/README.md`、`apps/mcp/AGENTS.md`、`apps/mcp/src/gateway/instructions.ts`。
- [ ] Edit `docs/design/workspace-mcp/tools.zh-CN.md`、`architecture.zh-CN.md`、`stages.zh-CN.md`。
- [ ] Create `.agents/skills/verify-uvw/bin/seed-skills.mjs`. Edit `.agents/skills/verify-uvw/features/mcp.md`.

**Build.**

- [ ] 在 `custom-skills.ts` 实现架构文档「gateway 发现流程」的六步。个人空间取 `spaces.list()` 中 `type === "personal"` 且 `affiliation === "owner"` 的一项；成员判断用 `spaces.get(spaceId).affiliation`；逐层 `browse` 找 `.agents/skills`；`readHtmlViewPage` 式的有上限严格 UTF-8 读取；`skillEntry` 校验；按名字合并并产出诊断。不缓存。
- [ ] 先写一个单测证明 `skillEntry` 能解析 `disable-model-invocation: true`、`user-invocable: false` 和 `argument-hint` 并保留在 frontmatter 里，再依赖它。不能解析时停下，向操作者报告，不自行加 YAML 依赖。
- [ ] `skills_read` 增加 `repo` 输入，目录项增加 `source`、`path`、`modelInvocable`、`userInvocable`、`argumentHint`，增加 `diagnostics`、`repository`、`binaryFiles`。自定义 skill 支持 `resource` 和 `full`。带 `repo` 时 `ToolResult.repo` 返回 Space ID。
- [ ] `seed-skills.mjs` 用 `uvw space node create --parent` 和 `uvw blob upload --parent` 在指定 Space 建 `.agents/skills/<name>/SKILL.md` 和附属文件，参数是 Space、skill 名、来源目录。
- [ ] 按架构文档「需要同步更新的文档」更新 README、AGENTS.md 的快照例外和 `docs/design/workspace-mcp` 三份文档。

**You see.**

- [ ] `$V mcp sk1-list skills_read '{"repo":"<owner>/<repo>"}'` 的 `$EVIDENCE/sk1-list.out` 里同时有 `source` 为 `builtin`、`user`、`repository` 的项，`repository` 为 `"loaded"`。

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `apps/mcp/test/reference-tools.test.ts` 增加用例：合并顺序、仓库级覆盖用户级并产出 `shadowed`、内置名字产出 `reserved-name`、`name` 与目录不一致产出 `invalid-skill`、超过 64 KiB 产出 `too-large`、非成员仓库为 `not-member` 且按名字读取失败、二进制文件只进 `binaryFiles`、清单外的 `resource` 被拒绝、`full` 超限报错、无自定义 skill 时内置列表与改动前一致。Run `pnpm --filter @univerjs/univer-workspace-mcp exec vitest run test/reference-tools.test.ts`.
- [ ] `frontmatter` 开关用例同上一文件。Run `pnpm --filter @univerjs/univer-workspace-mcp typecheck && pnpm --filter @univerjs/univer-workspace-mcp test`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `sonnet high` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. 在 trunk 和 head 各跑 `features/mcp.md` 的 MR1（`$V mcp mcp-skills-list skills_read` 等三条）。Save `sk1-mr1.png`，内容是两侧 `jq` 输出的终端截图。Pass when 两侧内置 skill 的名字列表都等于 MR1 的十个名字，head 的 `mcp.tool_call` 事件 `outcome` 为 `ok`。
- [ ] Lane 2. 用 `seed-skills.mjs` 在个人空间建 `weekly-report`，不带 `repo` 调 `skills_read`。Save `sk1-user.png`。Pass when 输出含 `weekly-report`，`source` 为 `user`，`repository` 为 `"no-repository"`。
- [ ] Lane 3. 在团队仓库建 `reconcile-ledger`，带 `repo` 调用。Save `sk1-repo.png`。Pass when 输出同时含 `weekly-report`（user）和 `reconcile-ledger`（repository），`repository` 为 `"loaded"`，事件里 `repo` 是该 Space ID。
- [ ] Lane 4. 仓库和个人空间各建一个同名 `report`。Save `sk1-shadow.png`。Pass when 目录只有一个 `report` 且 `source` 为 `repository`，`diagnostics` 有一条 `shadowed`，路径指向个人空间。
- [ ] Lane 5. 个人空间建名为 `sheet` 的 skill。Save `sk1-reserved.png`。Pass when `sheet` 的 `source` 仍为 `builtin`，`diagnostics` 有一条 `reserved-name`。
- [ ] Lane 6. 第二个用户建公开仓库并放入 skill，第一个用户以该仓库为 `repo` 调用。Save `sk1-nonmember.png`。Pass when `repository` 为 `"not-member"`，目录不含该 skill，按名字读取返回错误。
- [ ] Lane 7. 建 `bad-name` 目录但 `name: other`，再建缺 `description` 的 skill。Save `sk1-invalid.png`。Pass when 两者都不在目录里，各有一条 `invalid-skill`，`detail` 不含文件正文。
- [ ] Lane 8. skill 带 `references/guide.md`、`scripts/run.js` 和一张 PNG。按名字读取，再读 `references/guide.md`。Save `sk1-files.png`。Pass when `resources` 列出两个文本文件，PNG 只在 `binaryFiles` 里，`resource` 读取返回 `guide.md` 全文。
- [ ] Lane 9. 读取一个超过 100,000 字符的 `references/long.md`。Save `sk1-paging.png`。Pass when 第一次返回 `truncated: true` 和 `cursor`，用 `cursor` 续读后拼接内容与原文件逐字节相同。
- [ ] Lane 10. 用 Ask 模式的只读 agent token 调 `skills_read`，再修改个人空间里的 `SKILL.md` 描述后立即调用。Save `sk1-scope.png`。Pass when 只读 token 调用成功，第二次调用返回新描述，gateway 日志里没有 skill 正文。

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. `skills_read` 不带 `name` 的耗时 p50，取 verify-uvw 的 `mcp.tool_call` 事件或 `bin/mcp-bench.mjs` 的计时。trunk 和 head 都有不带自定义 skill 的场景。trunk 没有自定义 skill，所以另外单独计 head 上「10 个用户级加 10 个仓库级 skill，带 `repo`」的耗时。
- [ ] Probe. trunk 和 head 两个实例交替调用，各 20 次，先 trunk 后 head 轮流。两侧都要产出耗时。
- [ ] Baseline. Record the trunk 无自定义 skill 场景的 p50 first.
- [ ] Rule. 无自定义 skill 时，head p50 超过 trunk p50 加 150 ms 即失败。10 加 10 场景的 head p50 超过 800 ms 即失败。这两个数是预算，不是实测，首次测量后在 Appendix A 记录实测值。

**Review gate.** None. SK1 is not review-gated.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Rebased onto current trunk after the verdict, patch-id unchanged.
- [ ] 停在 merge-ready，交给操作者合入。

## Inject the catalog and show it in the rail (SK2)

**Depends on.** SK1.

**Files.**

- [ ] Edit `apps/workspace/web/src/features/agents/runtime/runner.ts`.
- [ ] Edit `apps/workspace/web/src/features/agents/runtime/runner.test.ts`.
- [ ] Edit `apps/workspace/web/src/features/agents/agent.types.ts`.
- [ ] Edit `apps/workspace/web/src/features/agents/ui/session-page.tsx`、`ui/messages.ts`、`ui/agents.css`。
- [ ] Create `.agents/skills/verify-uvw/bin/mock-provider.mjs`. Edit `.agents/skills/verify-uvw/SKILL.md`.

**Build.**

- [ ] 先做 `mock-provider.mjs`。它是一个 OpenAI 兼容的 SSE 服务，监听 127.0.0.1，`Access-Control-Allow-Origin: *`，按一个 JSON 脚本依次返回文本或工具调用，把每个请求体和到达时间写进日志文件，在 `res` 关闭时停止流。在 `SKILL.md` 写明如何在 Model settings 里把它配成 OpenAI 兼容 provider。
- [ ] 在 `agent.types.ts` 增加 `SkillCatalog` 等类型的 zod schema，以及读取 `metadata.agentSkills` 的函数。
- [ ] 在 `runner.ts` 的 `drive` 中，`client.tools()` 之后、`new Chat` 之前，实现架构文档「浏览器每次运行的流程」的第 1 至 4 步和第 6 步。以 `agentSkills` 作为已处理标记。目录提醒按 `referencesReminder` 的方式转义 `<`。`contextPrompt` 增加一行固定说明。
- [ ] 在 `session-page.tsx` 的 `agent-session-rail` 中，在 PR 小节之前加 Skills 小节。数据只取最后一条用户消息的 `agentSkills` 和历史里的 `skills_read` 调用。前 3 条，其余折叠，折叠样式和文案模式参照 `AgentStepsGroup`。展开区列出诊断。`not-member` 和无 skill 各显示一行说明。中英文案同时加。

**You see.**

- [ ] 仓库作用域的新会话发送第一条消息后，右侧栏出现 Skills 小节，列出仓库级和个人级 skill，mock provider 日志里第一个请求的最后一条用户消息含目录提醒。

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `runtime/runner.test.ts` 的 `setup` 增加 `skills` 选项，`tools/list` 加入 `skills_read`，`tools/call` 按工具名分支。新增用例：有和没有 skill 时系统提示词逐字相同；第一轮追加目录提醒；目录不变的第二轮不追加；切换仓库的一轮追加，且第二轮请求体以第一轮请求体为前缀；审批恢复再次进入 `drive` 时不调用 `skills_read`，已发出的消息不变；`skills_read` 失败时运行继续；`modelInvocable` 为 false 的 skill 不进提醒。Run `pnpm --filter @univerjs/univer-workspace test web/src/features/agents/runtime/runner.test.ts`.
- [ ] Run `pnpm --filter @univerjs/univer-workspace typecheck` and `pnpm --filter @univerjs/univer-workspace build:web`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `sonnet high` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. 在 trunk 和 head 用 mock provider 跑同一个两轮对话，不准备任何 skill。trunk 没有 skill 功能，记录这一点。Save `sk2-regression.png`。Pass when head 的会话正常完成，右侧栏的 Skills 小节显示空状态说明，两轮请求的系统提示词与 trunk 逐字相同。
- [ ] Lane 2. 准备 2 个仓库级和 2 个个人级 skill，在仓库页新建会话并发送。Save `sk2-rail.png`。Pass when 右侧栏列出 4 个 skill 并带来源标签，mock 日志的第一个请求含 4 项目录提醒。
- [ ] Lane 3. 准备 6 个 skill。Save `sk2-collapse.png`。Pass when 默认只显示 3 个和「显示其余 3 个」，点开后显示全部 6 个，可以收起。
- [ ] Lane 4. mock 脚本让模型调用 `skills_read {name: "reconcile-ledger"}`。Save `sk2-used.png`。Pass when 该 skill 在右侧栏排在第一位并带「已使用」标记，步骤列表里有这次工具调用。
- [ ] Lane 5. 同一会话发第二条消息，不改 skill。Save `sk2-stable.png`。Pass when mock 日志第二个请求体以第一个请求体为前缀，第二条用户消息不含目录提醒，右侧栏的缓存命中率不下降。
- [ ] Lane 6. 两轮之间在个人空间新增一个 skill。Save `sk2-change.png`。Pass when 第二条用户消息含替换旧清单的完整新目录，请求前缀不变，右侧栏多出这个 skill。
- [ ] Lane 7. 全局作用域开始会话，第二轮切换到某个仓库。Save `sk2-scope.png`。Pass when 第一轮目录只有个人级，第二轮目录加入仓库级，系统提示词两轮相同。
- [ ] Lane 8. 以非成员身份把会话作用域设为别人的公开仓库。Save `sk2-nonmember.png`。Pass when 右侧栏显示「未加载：你不是该仓库成员」，目录提醒里没有该仓库的 skill。
- [ ] Lane 9. 准备同名覆盖、内置同名和一个无效 skill。Save `sk2-diagnostics.png`。Pass when 右侧栏展开区列出三条诊断并给出路径，三者都不在目录提醒里。
- [ ] Lane 10. 发送后用 mock 返回一个需要审批的发布工具，批准后会话继续。Save `sk2-approval.png`。Pass when 批准后的恢复请求不含新的目录提醒，第一条用户消息内容与审批前相同。

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. 从点击发送到 mock provider 收到第一个模型请求的时间。点击时间用 `agent-browser eval` 在页面记录 `Date.now()`，到达时间取 mock 日志。trunk 和 head 都有这个指标。另外单独计 head 上 `skills_read` 列目录调用本身的耗时。
- [ ] Probe. trunk 和 head 各 10 次，交替进行，head 准备 10 个个人级加 10 个仓库级 skill，trunk 无 skill。
- [ ] Baseline. Record the trunk 中位数 first.
- [ ] Rule. head 中位数超过 trunk 中位数加 500 ms 即失败。这是预算，首次测量后在 Appendix A 记录实测值。

**Review gate.** The operator reviews before merge.

- [ ] Copy lane 2, 3, 4 and 9 screenshots into `/tmp/swarm-SK2/review/SK2-review-<slug>.png`.
- [ ] Record a 30 to 60 second video of the change on a lane VM. Save it as `/tmp/swarm-SK2/review/SK2-review.mp4`. 本仓库没有云 VM，在 lane 的 verify-uvw 实例上用 `agent-browser` 录制。
- [ ] Post the screenshots and the video in chat. Stop at merge-ready. Wait for the operator's click.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Rebased onto current trunk after the verdict, patch-id unchanged.
- [ ] 停在 merge-ready，交给操作者合入。SK2 的 base 是 SK1 的分支。

## Invoke a skill with a slash command (SK3)

**Depends on.** SK2.

**Files.**

- [ ] Edit `apps/workspace/web/src/features/agents/runtime/runner.ts`、`runtime/runner.test.ts`、`runtime/approvals.ts`、`runtime/approvals.test.ts`。
- [ ] Edit `apps/workspace/web/src/features/agents/agent.types.ts`.
- [ ] Edit `apps/workspace/web/src/features/agents/ui/composer.tsx`、`ui/composer-editor.tsx`、`ui/session-page.tsx`、`ui/messages.ts`、`ui/agents.css`。
- [ ] Create `apps/workspace/web/src/features/agents/ui/skill-menu.tsx`.

**Build.**

- [ ] runner 增加 `skills(scope)`。它用 `deps.createTokenSource("ask")` 建短时 MCP client，调用 `skills_read` 后关闭。
- [ ] 在 `drive` 的第 5 步实现显式调用展开。匹配 `userInvocable` 的 skill，计算 `digest`，同 `digest` 重复调用只追加一句「已加载」，替换 `$ARGUMENTS` 或追加 `ARGUMENTS:`，写入 `agentSkillInvocation`，读取失败时以错误结束本次运行。
- [ ] `gateTools` 增加被禁名字集合参数，模型以这些名字调用 `skills_read` 时拒绝。
- [ ] `skill-menu.tsx` 是一个列表菜单，显示 `/name`、来源、描述和 `argument-hint`，支持过滤、方向键、Enter、Tab 和 Esc。首页 `ComposerEditor` 中按高于 `COMMAND_PRIORITY_HIGH` 的优先级接管这些键，会话页 `Textarea` 在 `onKeyDown` 中处理。会话运行中不弹出。
- [ ] 用户消息气泡把开头的 `/name` 渲染成标签，解析函数放在 `agent.types.ts`，仿照 `messageReferences`。

**You see.**

- [ ] 在首页输入 `/wee`，菜单只剩 `weekly-report`，按 Tab 补全成 `/weekly-report `，输入参数后发送，消息气泡开头是 skill 标签，mock 日志的请求里有渲染后的正文和参数。

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `runtime/runner.test.ts` 新增用例：正文含 `$ARGUMENTS` 时被替换；不含时追加 `ARGUMENTS:`；无参数时两者都不出现；同 `digest` 重复调用只追加短提示；内容变化后追加全文；不匹配的 `/x` 按普通文本发送且不调用 `skills_read {name}`；读取失败时会话进入错误状态且消息保留；系统提示词仍逐字不变。Run `pnpm --filter @univerjs/univer-workspace test web/src/features/agents/runtime/runner.test.ts`.
- [ ] `runtime/approvals.test.ts` 新增用例：被禁名字的 `skills_read` 被拒绝，其他名字放行。Run `pnpm --filter @univerjs/univer-workspace test web/src/features/agents/runtime/approvals.test.ts`.
- [ ] Run `pnpm --filter @univerjs/univer-workspace typecheck` and `pnpm --filter @univerjs/univer-workspace build:web`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `sonnet high` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. 在 trunk 和 head 的首页和会话页各发一条以 `/api` 开头的普通消息。trunk 没有 `/` 菜单，记录这一点。Save `sk3-regression.png`。Pass when head 上没有名为 `api` 的 skill 时消息按普通文本发送，mock 收到原文，会话正常完成。
- [ ] Lane 2. 首页全局作用域输入 `/`。Save `sk3-menu-home.png`。Pass when 菜单只列个人级、`userInvocable` 的 skill，每项有来源、描述和 `argument-hint`。
- [ ] Lane 3. 仓库页输入 `/rec` 并用方向键和 Tab 选择。Save `sk3-filter.png`。Pass when 过滤后只剩匹配项，Tab 补全为 `/reconcile-ledger `，Esc 关闭菜单且不清空输入。
- [ ] Lane 4. 发送 `/weekly-report 2026-W46`，skill 正文含 `$ARGUMENTS`。Save `sk3-args.png`。Pass when 气泡开头是标签，mock 请求里 `$ARGUMENTS` 被替换为 `2026-W46`，模型没有再调用 `skills_read`。
- [ ] Lane 5. 对正文不含 `$ARGUMENTS` 的 skill 带参数发送。Save `sk3-appended.png`。Pass when mock 请求里正文末尾有 `ARGUMENTS: <参数>`。
- [ ] Lane 6. 在会话页追加输入框里对同一 skill 再调用一次，内容不变。Save `sk3-repeat.png`。Pass when 第二次只追加「已加载」短句，请求前缀不变。
- [ ] Lane 7. 会话运行中在追加输入框输入 `/`。Save `sk3-running.png`。Pass when 不弹出菜单，输入作为引导消息排队并按普通文本处理。
- [ ] Lane 8. `disable-model-invocation: true` 的 skill，先用 `/` 调用，再让 mock 脚本让模型按名字读取它。Save `sk3-manual-only.png`。Pass when `/` 调用成功，目录提醒里没有它，模型的读取被拒绝并收到原因。
- [ ] Lane 9. `user-invocable: false` 的 skill。Save `sk3-model-only.png`。Pass when 菜单里没有它，直接输入 `/name` 按普通文本发送，模型仍能通过 `skills_read` 读取。
- [ ] Lane 10. 打开菜单选中 skill 后，在另一个标签页删掉它的 `SKILL.md`，再发送。Save `sk3-deleted.png`。Pass when 本次运行以错误结束并显示原因，用户消息保留，重发普通消息后会话继续。

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. 从点击发送到 mock 收到第一个模型请求的时间，分 `/name` 调用和普通消息两种。trunk 没有 `/` 调用，trunk 只测普通消息。另外单独计 `skills(scope)` 打开菜单到列表出现的时间。
- [ ] Probe. trunk 普通消息、head 普通消息、head `/name` 调用三组交替，各 10 次。
- [ ] Baseline. Record the trunk 普通消息中位数 first.
- [ ] Rule. head 普通消息中位数超过 SK2 的预算即失败。head `/name` 调用中位数超过 head 普通消息中位数加 300 ms 即失败。菜单列表出现时间中位数超过 800 ms 即失败。这些是预算，首次测量后在 Appendix A 记录实测值。

**Review gate.** The operator reviews before merge.

- [ ] Copy lane 2, 3, 4 and 8 screenshots into `/tmp/swarm-SK3/review/SK3-review-<slug>.png`.
- [ ] Record a 30 to 60 second video of the change on a lane VM. Save it as `/tmp/swarm-SK3/review/SK3-review.mp4`. 本仓库没有云 VM，在 lane 的 verify-uvw 实例上用 `agent-browser` 录制。
- [ ] Post the screenshots and the video in chat. Stop at merge-ready. Wait for the operator's click.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Rebased onto current trunk after the verdict, patch-id unchanged.
- [ ] 停在 merge-ready，交给操作者合入。SK3 的 base 是 SK2 的分支。三层都有结论后，操作者用 `gh stack link` 关联并用 `gh stack merge` 合入，或逐层合入。

## Close the program

- [ ] Every box above is checked with its evidence.
- [ ] Reply to the operator with the report the execution playbook names.
- [ ] 把 Appendix A 的实测性能值和未证实项补齐，并在 `apps/workspace/docs/architecture.md` 的 Agents 相关章节记录落地后的现状。

## Appendix A. Prototype evidence

本计划没有运行原型。设计阶段的未证实项已在执行中验证：

- `skillEntry`（`@modelcontextprotocol/server@2.4.0`）把 `disable-model-invocation`、`user-invocable` 保留为布尔值，`argument-hint` 保留为字符串（SK1 单测）。
- `uvw space node create --parent` 和 `uvw blob upload --parent` 能在 `.agents/skills/<name>/` 这样点开头的嵌套目录里建目录和上传文件。名为 `..` 的目录也能创建，gateway 对它产出 `invalid-skill` 诊断（SK1 MR13 和修复验证）。
- 浏览器到 `127.0.0.1` 上 mock provider 的跨端口请求没有被拦截。SPA 没有 CSP，mock 需要应答 `authorization, content-type` 的预检（SK2）。

性能实测值。机器同时运行其他验证任务，以下是本地开发实例上的中位数：

| PR | 指标 | trunk | head | 预算 |
| --- | --- | --- | --- | --- |
| SK1 | `skills_read` 列目录，无自定义 Skill（gateway `duration_ms`，各 20 次） | 3.9 ms | 16.9 ms | trunk 加 150 ms |
| SK1 | 同上，10 个个人级加 10 个仓库级 Skill | 无 | 41.3 ms | 800 ms |
| SK2 | 点击发送到 mock 收到第一个模型请求，head 带 10 加 10 个 Skill（各 10 次） | 188 ms | 322 ms | trunk 加 500 ms |
| SK3 | 同上，普通消息 / `/weekly-report` 调用（各 10 次） | 205.5 ms | 205.5 ms / 210.5 ms | 普通消息加 300 ms |
| SK3 | 首次打开 `/` 菜单到出现选项（每次重新加载页面，10 次） | 无 | 56 ms | 800 ms |

## Appendix B. Alternatives rejected

- **目录放进系统提示词。** 会话作用域可以切换，skill 可以随时修改，放进系统提示词会破坏提示缓存。改为追加在用户消息里的 `<system-reminder>`。
- **在 `launch` 里取目录。** `launch` 没有 MCP client，再建一个 client 会多一次 token 交换。改为在 `drive` 里复用已有 client，用 `agentSkills` 标记保证不重复处理。
- **浏览器直接读 Blob 并解析 skill。** 会让发现逻辑只服务浏览器，外部 MCP 客户端和 CLI 读不到。改为放在 gateway 的 `skills_read`。
- **用户级 skill 存 IndexedDB 或新数据库表。** 前者换设备即丢失，后者要改 schema。改为个人空间。
- **新增 YAML 依赖做宽松校验。** MCP SDK 已有 `skillEntry`，与内置 skill 同一套规则。改为严格校验并展示诊断。
- **AI SDK 的 `HarnessAgent`。** 需要沙箱，会话历史归运行时所有，浏览器无法使用。只借用它的 skill 形状。

## Appendix C. Risks

- **本机资源。** 每个 live lane 启动一套 verify-uvw 和 Docker 里的 gateway，同时超过 3 套会让测试超时。SK1 至 SK3 的 lane 分批运行，owner 用 `uptime` 观察负载。
- **端口冲突。** 默认端口可能被其他会话的实例占用。每个 lane 使用自己的 `VERIFY_UVW_RUN` 和端口（SK1 至 SK3）。
- **生产 MCP 配置。** 全局 opencode 配置连着已认证的 space.univer.ai MCP，验证时不要用全局 opencode（SK1）。
- **`reference-tools.test.ts` 的精确断言。** 新字段会改动现有断言，owner 要确认改动只是新增字段，内置 skill 的行为不变（SK1）。
- **快照规则冲突。** `apps/mcp/AGENTS.md` 要求 Skills 扩展和 `skills_read` 同一快照，SK1 必须写明自定义 skill 的例外。
- **Lexical 的 Enter 处理。** 菜单键位优先级不对时，Enter 会插入换行或误发送（SK3）。
- **合入方式。** auto-mode 分类器曾拒绝合入操作，`gh stack merge` 曾带着未验证的上层一起合入。所以本计划只到 merge-ready，各层都有结论后才关联 stack。

## Appendix D. Links and reading list

- 设计：[agent-skills.md](./agent-skills.md)。架构：[agent-skills-architecture.md](./agent-skills-architecture.md)。
- 改动前必读：根 `AGENTS.md` 的「Workspace Agents 提示缓存」，`apps/mcp/AGENTS.md`，`apps/workspace/AGENTS.md`，`.agents/skills/verify-uvw/SKILL.md` 和 `features/mcp.md` 的 MR1。
- SK1 的发现逻辑跨 client-core 多个功能，实现前用 pstack 的 `how` 技能确认调用路径。SK2 的 `drive` 改动涉及提示缓存不变量，合入前用 pstack 的 `interrogate` 技能做一轮对抗审查。
- 决策记录按 pstack 的 `show-me-your-work` 技能保存在执行者本地，不提交。
