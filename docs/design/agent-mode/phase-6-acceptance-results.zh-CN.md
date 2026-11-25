# Agent Mode 阶段 6 验收结果

> 日期 2026-11-25。对应 [规格](spec.zh-CN.md) 6.7 的完成标准 A6.1 到 A6.8，以及 1.3 的前三项指标。
> 运行基于 `main` 的 `65f24e6f`，阶段 0 到 6 已合入。verify-uvw 的 MCP 模式，run id `p69`。
> 证据在运行机器的 `/tmp/verify-uvw/p69/evidence/` 下，不在仓库里。下文的文件名都相对这个目录。引用的证据都通过了 `$V secret-check`（748 个文件）。

## 1. 结论

- **A6.1 到 A6.6 和 A6.8 都走通了。** 每个故事只跑了一次，模型是 `console-deepseek/deepseek-flash#high`，客户端是 `mcp`（opencode v2.0.29），和[第一版验收](acceptance-results.zh-CN.md)相同。verify-uvw 现在的默认值也是这一组。没有一次因为模型失败而重跑，也没有用到点名 Issue 编号的重试。
- **任务只在 Issue 和打回理由里。** 授权之后，A、A3、B3 的每一次运行都只用一句固定提示词“看看有没有等你处理的工作，处理完。”。唯一带任务内容的提示词是 A6.4 里给 A3 的那一次准备，它就是头部的授权。A6.5 按约定重跑第一版故事 2，沿用它带任务的提示词。故事 4 和故事 5 的 Issue 写出了做法（fork、拆分、关联、检查、合入、提交），故事 7 的只写了一部分，见 2.3。
- **人的动作和 6.7 一致。** 故事 4 三次：加成员、写 Issue、验收。故事 5 三次：写 Issue、打回、验收。故事 6 一次：撤回。故事 7 为零。
- **中途没有拒绝。** 所有 agent 运行里，`AGENT_NOT_ALLOWED` 和 `INTERACTIVE_SESSION_REQUIRED` 在 `mcp.tool_call` 事件、transcript 的工具结果和 `workspace_ceiling_denials_total` 三处都是 0，事件的 `principal_category` 都是 `agent_claimed`。
- **尾部几十秒能判断。** 验收人从打开面板到给出结论：故事 4 是 40.9 秒，读 3 个 pull request、4 个文件的对比和 6 条检查结论。故事 5 打回 23.2 秒、验收 24.3 秒。故事 6 撤回 19.0 秒。H 由驱动者按脚本扮演，这些是下限，见 2.4。故事 7 的验收人是 A3，不需要人。
- **交接不再靠驱动者转达。** 故事 7 里 B3 和 A3 各只用固定提示词跑了一轮，B3 自己找到 Issue、提议、提交，A3 自己找到等它验收的 Issue 和能合入的 pull request，报告检查、合入、验收。第一版故事 3 有 25.9% 的时间是驱动者转达，本次转达的任务内容为零。
- **需要驱动者的地方有一处。** A3 在自己的仓库里写 `.agents/checks.md`，要用 `space_node`（admin 工具集）和 `blob_upload`（files 工具集）。agent 的默认连接是 `core`，没有这两个工具，所以 A3 的连接带上了 `?toolsets=all`，见第 9 节。

## 2. 怎样复现

### 2.1 实例

```bash
V=.agents/skills/verify-uvw/bin/verify-uvw
export VERIFY_UVW_RUN=p69 VERIFY_UVW_SERVER_PORT=4081 VERIFY_UVW_WEB_PORT=6101 VERIFY_UVW_MCP_PORT=4082
VERIFY_UVW_MCP=1 $V up
$V user
$V doctor          # 38 ok, no FAIL lines (doctor.txt)
```

`run.env` 记录的启动 HEAD 是 `65f24e6f90061ff8a9255ab773f44cc2e07dab86`。驱动用的脚本都在 `driver/` 下：`p.sh` 设置环境，`collect.sh` 取指标和事件，`trunk.sh` 读回 Trunk，`setup-*.sh` 和 `agent.sh` 是准备，`s4-grant.sh`、`s5-grant.sh`、`s65.sh`、`s7-setup.sh`、`s7-rounds.sh` 是故事，`a66-budget.sh` 是 A6.6。`acceptance-summary.mjs` 从证据算出第 8 节的数字，写进 `acceptance-summary.json`。

### 2.2 身份和数据

| 身份 | 是谁                             | 怎样来的                                                                       |
| ---- | -------------------------------- | ------------------------------------------------------------------------------ |
| H    | 运行用户 `verify-p69`            | `$V user`。S 和 S2 的 owner                                                    |
| E    | 人 `verify-p69-editor`（Erin）   | 按 `features/mcp-html-view.md` MHV8 的方式注册，有自己的 uvw home。S 的 editor |
| C    | 人 `verify-p69-claimer`（Casey） | 同上。A、A3、B3 的认领人                                                       |
| A    | agent `setup-principal-a-90ky`   | `driver/agent.sh a`：`$V principal`，再由 C 的 Browser 登录会话认领            |
| A3   | agent `setup-principal-a3-fyyk`  | 同上                                                                           |
| B3   | agent `setup-principal-b3-1xe2`  | 同上                                                                           |

三个 agent 用掉每小时 5 个创建配额中的 3 个。认领是准备工作，claim code 在证据里替换成了 `<claim-code-used>`。和规格 6.3 的设定对照：H 是 S 的 owner，owner 的能力包含 admin；A 由 H 以外的 C 认领。

S 是 H 的私有 Team Space `verify-p69/sales`，准备时放进三张 Sheet：North（120、135、150）、South（80、86、92）、East（100、110、105），A 列 Month，B 列 Revenue（`setup-after.trunk.txt`）。E 是 S 的 editor。`.agents/checks.md` 声明两项检查，S 的 `landing` 是 `checks`（`setup-checks.md`、`setup-landing.out`）：

```markdown
## totals-match

On every region Sheet (North, South, East) that has a Total row, the Total equals the sum of the month rows above it.

## header-unchanged

Row 1 of every region Sheet still reads Month in A1 and Revenue in B1.
```

S2 是 H 的第二个 Team Space `verify-p69/sales-review`，三张 Sheet 和 S 相同，`landing` 保持默认的 `review`（`setup2-merge.out`，`s65-trunk-start.trunk.txt`）。

### 2.3 提示词

提示词逐字如下，也在每次运行的 `<label>/prompt.txt` 里。

```bash
FIXED='看看有没有等你处理的工作，处理完。'
# A6.1 story 4: driver/s4-grant.sh (H adds A as editor, writes Issue #2 from s4-issue-body.md), then
$V story --as a s4-a mcp "$FIXED"
# A6.2 story 5: driver/s5-grant.sh (H writes Issue #6 from s5-issue-body.md), then
$V story --as a s5-a1 mcp "$FIXED"
# H sends Issue #6 back in the panel with s5-send-back-reason.txt, then
$V story --as a s5-a2 mcp "$FIXED"
# A6.5: driver/s65.sh
$V story --as a s65-a mcp '我把你加进了仓库 verify-p69/sales-review。South 表里 Feb 的 Revenue 录错了，应该是 88。请在你自己的 fork 里改正，核对改对了，然后直接合入。'
# A6.4 story 7: driver/s7-setup.sh, A3 connected with ?toolsets=all
$V story --as a3 s7-a3-setup mcp '建一个新仓库，名为 budget-2028。在里面放一张 Sheet，叫 Budget，A 列 Item、B 列 Amount，列出 Rent 3000、Salaries 12000、Marketing 2500 三项预算，最后一行用公式算 Total，然后合入。再在仓库根目录建一个 .agents 文件夹，放一个 checks.md，声明两项检查：totals-match，Total 等于上面各项之和；header-unchanged，第 1 行仍是 Item 和 Amount。然后把 agent setup-principal-b3-1xe2 加进这个仓库，只给读权限，再写一个 Issue 指派给它：把 Marketing 的预算改成 4000，核对 Total 也跟着变了，提交给我验收。'
# then driver/s7-rounds.sh: s7-b3-r<n> and s7-a3-r<n> alternate on "$FIXED", n = 1..4
```

故事 4 的 Issue（`s4-issue-body.md`）：

> North、South、East 三张表各在数据下面加一行 Total，用公式算出 Revenue 的合计。再新建一个 Doc，叫 Q1 summary，写出三个地区 Q1 的 Revenue 合计和总计。
>
> 请在你自己的 fork 里做，分三个 pull request：第一个给 North 和 South 加 Total，第二个给 East 加 Total，第三个新建 Q1 summary。每个 pull request 都关联这个 Issue，合入前按仓库声明的检查逐项核对并报告，都通过后自己合入。三个都合入后提交验收，写明做了什么、核对了什么、做了哪些假设。

故事 5 的 Issue（`s5-issue-body.md`）：

> 新建一张 Sheet，叫 West，录入 West 地区 Q1 的 Revenue：Jan 70，Feb 75，Mar 80。版式和 North、South、East 三张表一致：A 列 Month，B 列 Revenue，第 1 行是表头，月份下面一行是 Total，用公式算合计。
>
> 在你自己的 fork 里用一个 pull request 完成，关联这个 Issue，按仓库声明的检查核对并报告，通过后自己合入，然后提交验收。

这两个 Issue 几乎写出了整条路径：用 fork、拆成几个 pull request、关联 Issue、报告检查、自己合入、提交验收。它们是交办的人写进任务的要求，不是给 agent 的提示词，所以不算转达。但这样一来，故事 4 和故事 5 证明的是 agent 只凭固定提示词能找到自己的工作，并用工具按 Issue 写的步骤做完；不证明 agent 在没有人写出步骤时自己想到这条路径。故事 7 里 A3 写给 B3 的 Issue（`s7-issue-initial.json`）说了改什么、核对什么、在 pull request 里改、不要动表头、“用 issue_verdict submit 提交给我验收”，没有写关联 Issue 和报告检查，这两步是 B3 自己做的。

### 2.4 怎样计数和计时

沿用[第一版](acceptance-results.zh-CN.md) 2.4 的规则，改了下面几处。

- **人的动作。** 驱动者每做一个人的动作，就在 `timeline.tsv` 里写一行。H 加成员和写 Issue 用 uvw，看面板、通过、打回和撤回用 Browser（agent-browser，1440 × 1500）。认领和 E 在故事 6 里的编辑是准备，不算任务里的人的动作。
- **一次运行的起止。** 起点是 `run-meta.json` 的 `started_at`，终点是起点加上 `duration_seconds`。第一版用驱动者在 `story` 返回之后写的标记。两次运行的标记都只比 `run-meta.json` 的终点晚 0.1 到 0.3 秒（本次故事 4 是 0.27 秒，第一版故事 1 是 0.24 秒），所以两种取法的结果几乎相同，和第一版的对比不受影响。
- **任务时长。** 从第一次 agent 运行开始，到最后一个结论（`accepted`）和最后一次 agent 运行结束两者中较晚的一个。结论的时间取 Issue 时间线的事件时间（`<story>-issue-final.out`）。A6.5 没有 Issue，终点是运行结束和 `pr_merge` 事件中较晚的一个。
- **等人。** 从验收人打开面板（`timeline.tsv` 的 `human action … start`）到 Issue 时间线上的 `sent_back` 或 `accepted`。这一段就是“验收人的时间”。H 由驱动者按脚本扮演：打开页面，等 4 秒，展开每个 `Compare`，等 10 秒加载对比，截图，再点按钮。真人读得更久，所以这是下限。
- **驱动者间隔。** 任务时长减去 agent 运行和等人，剩下的是驱动者间隔：一次运行结束到下一步开始之间，驱动者读结果、启动下一次运行或打开面板的时间。它对应真实部署里 harness 唤醒 agent 或人看到通知的延迟。第一版把这一段叫“转达”，因为那时下一次运行的提示词带着任务内容。本次另数“授权之后带任务内容的提示词”，这一项才是转达，它在每个故事里都是 0。
- **拒绝、工具调用。** 和第一版相同。调用数来自 `<label>/trajectory.txt`，到达 Workspace 的调用来自 `<label>-events.events.jsonl`。

## 3. A6.1：故事 4，三个 pull request，一次验收

**走通。** A 是 S 的 editor，S 的 `landing` 是 `checks`。A 只收到固定提示词。它用 `search` 找到 Issue #2，创建 fork `setup-principal-a-90ky/q1-totals`，依次完成 pull request #3（North、South）、#4（East）、#5（新建 Doc `Q1 summary`），每个都用 `pr_edit` 关联 Issue，`pr_ready` 之后报告两项检查，再自己合入，最后提交。H 在验收面板上看完，通过。

| 时间（UTC）  | 谁  | 做了什么                                                  | 证据                                                        |
| ------------ | --- | --------------------------------------------------------- | ----------------------------------------------------------- |
| 08:09:11.020 | H   | 把 A 加为 S 的 editor，人的动作 1                         | `s4-h-add-member.out`，`timeline.tsv`                       |
| 08:09:11.289 | H   | 写 Issue #2 并指派给 A，人的动作 2                        | `s4-h-issue.out`，`s4-issue-final.out`                      |
| 08:09:19.922 | A   | 开始运行，提示词是固定的一句                              | `s4-a/prompt.txt`，`s4-a/run-meta.json`                     |
| 08:11:19.128 | A   | `fork_create`                                             | `s4-a-events.events.jsonl`                                  |
| 08:13:17.201 | A   | 两项 `pr_check` 之后合入 #3                               | 同上，`s4-pr-3.out`                                         |
| 08:13:54.012 | A   | 合入 #4                                                   | 同上，`s4-pr-4.out`                                         |
| 08:15:34.246 | A   | 合入 #5                                                   | 同上，`s4-pr-5.out`                                         |
| 08:15:54.304 | A   | `issue_verdict` submit                                    | `s4-issue-final.out`                                        |
| 08:16:18.922 | A   | 运行结束                                                  | `s4-a/run-meta.json`                                        |
| 08:16:32.080 | H   | 打开 Issue #2，面板直接显示 `Acceptance`，人的动作 3 开始 | `s4-h-panel.png`，`timeline.tsv`                            |
| 08:17:12.997 | H   | 展开 4 个对比之后点 `Accept`，Issue 以 completed 关闭     | `s4-h-pull-1.png` 到 `s4-h-pull-3.png`，`s4-h-accepted.png` |

**H 在面板上读了什么。** 面板按顺序列出：Issue 原文；A 的提交说明，分“做了什么”“核对”“假设”三段，并列出三个 pull request 的链接；三个 pull request，每个显示 `Merged`、`opened by setup-principal-a · merged by setup-principal-a`；4 个文件，每个有 `Compare`，展开后左边是合入前一刻的 Trunk，右边是合入结果；每个 pull request 两条检查结论，共 6 条，都是 `Passed` 并带 A 写的说明；对外动作里，发布的页面和文件、授予的成员身份都是 `None`，这个 Team Space 只对成员开放。第三部分，指派对象在自己 Personal Space 里开的分享，H 看到的是 `Only the assignee and the user who claimed it can see this part.`，因为 A 的认领人是 C，不是 H。

**工具调用和拒绝。** 模型调用 83 次，其中 67 次到达 Workspace。两个拒绝码三处都是 0（`s4-a-transcript-refusals.txt`，`s4-denials-delta.txt`）。Workspace 的错误有 3 次，都是 `outline` 的 `workspace-argument-invalid`：模型同时发了三个既没有 `trunk: true` 也没有 `worktree` 的调用，换了参数后成功。另有一次 `fork_view` 少了 `fork` 参数，被 opencode 按 schema 拒绝，没有到达 Workspace。

**Trunk。** 任务开始时三张 Sheet 第 5 行是空的（`s4-trunk-start.trunk.txt`）。验收后第 5 行是 `Total` 和 `=SUM(B2:B4)`，值分别是 405、258、315（`s4-trunk-after.trunk.txt`）。Trunk 上的 `Q1 summary` 有一张表：North 405，South 258，East 315，总计 978（`s4-trunk-doc-after.out`）。三个 pull request 的 Unit 结果都是 `merged`，检查都是 `passed 2, missing 0`，都关联 Issue #2。

**时间。** 任务 473.1 秒，A 运行 419 秒。等人 40.9 秒（8.6%），就是 H 在面板上的时间。驱动者间隔 13.2 秒（2.8%）。三次合入在 A 的运行里完成，最后一次在 08:15:34，比 H 打开面板早 58 秒：改动先落到 Trunk，人的验收不在它的关键路径上。

## 4. A6.2：故事 5，打回再验收

**走通。** H 写 Issue #6 指派给 A。A 用固定提示词运行两次。第一次新建 fork `setup-principal-a-90ky/west-q1`，用 pull request #7 新建 Sheet `West` 并合入，提交。H 打回。第二次 A 用 `search` 找到被打回的 Issue，读到理由，在同一个 fork 里用新的 pull request #8 修正、合入，再提交。H 通过。

| 时间（UTC）  | 谁  | 做了什么                             | 证据                                                         |
| ------------ | --- | ------------------------------------ | ------------------------------------------------------------ |
| 08:18:25.893 | H   | 写 Issue #6 并指派给 A，人的动作 1   | `s5-h-issue.out`，`s5-issue-final.out`                       |
| 08:18:30.952 | A   | 第一次运行开始，固定提示词           | `s5-a1/prompt.txt`，`s5-a1/run-meta.json`                    |
| 08:22:22.626 | A   | 两项 `pr_check` 之后合入 #7          | `s5-a1-events.events.jsonl`                                  |
| 08:22:59.716 | A   | 提交                                 | `s5-issue-final.out`                                         |
| 08:23:43.952 | A   | 第一次运行结束                       | `s5-a1/run-meta.json`                                        |
| 08:24:15.301 | H   | 打开面板，人的动作 2 开始            | `s5-h-panel-1.png`，`s5-h-1-pull-1.png`                      |
| 08:24:38.537 | H   | 写理由，点 `Send back`               | `s5-h-sent-back.png`，`s5-after-send-back.out`               |
| 08:24:50.161 | A   | 第二次运行开始，固定提示词           | `s5-a2/prompt.txt`                                           |
| 08:26:37.214 | A   | 合入 #8                              | `s5-a2-events.events.jsonl`                                  |
| 08:26:44.589 | A   | 再次提交                             | `s5-issue-final.out`                                         |
| 08:27:03.161 | A   | 第二次运行结束                       | `s5-a2/run-meta.json`                                        |
| 08:27:09.595 | H   | 打开面板，人的动作 3 开始            | `s5-h-panel-2.png`，`s5-h-2-pull-1.png`，`s5-h-2-pull-2.png` |
| 08:27:33.893 | H   | 点 `Accept`，Issue 以 completed 关闭 | `s5-h-accepted.png`                                          |

**打回的理由。** H 读了第一次的结果（`s5-trunk-after-run1.trunk.txt`，`s5-h-1-pull-1.png`）：`West` 的 A1:B5 是 Month、Revenue、70、75、80、Total `=SUM(B2:B4)` 等于 225，和 Issue 写的每一条要求都一致，检查结论也都 passed。没有真实的缺口，也没有漏掉的要求，所以理由如实写明是改了需求。理由原文（`s5-send-back-reason.txt`）：

> West 的数据和版式都对，这一版没有错。退回是因为我改了需求，Issue 里原来没写：请在 West 的 Total 下面再加一行 Average，用公式算 Jan 到 Mar 三个月的平均值。

第二次运行之后，`West` 第 6 行是 `Average` 和 `=AVERAGE(B2:B4)`，值 75，其余不变（`s5-trunk-after.trunk.txt`，`s5-h-2-pull-1.png`）。验收面板列出 #8 和 #7 两个 pull request，各自的对比和检查结论都在。

**工具调用和拒绝。** 两次运行分别调用 57 次和 58 次，到达 Workspace 42 次和 41 次。两个拒绝码三处都是 0。第二次运行有 4 次 Workspace 的错误：3 次 `inspect` 把工作表名写成 `"Sheet 1"`，返回 `workspace-argument-invalid`，改成正确的选择器后成功；1 次 `issue_verdict` 返回 `ISSUE_ALREADY_SUBMITTED`，是模型想改正提交说明里写错的链接而再提交一次，它随后改用评论更正。第一次运行里，模型在 opencode 的 `execute` 包装里调用了一次 `fetch('http://127.0.0.1:1/')`，连接失败，没有别的影响，见 9.4。

**时间。** 任务 542.9 秒，A 运行共 446 秒。等人 47.5 秒（8.8%）：打回 23.2 秒，验收 24.3 秒。驱动者间隔 49.4 秒（9.1%）：第一次运行结束到 H 打开面板 31.3 秒，打回到第二次运行开始 11.6 秒，第二次运行结束到 H 打开面板 6.4 秒。

## 5. A6.3：故事 6，撤回

**走通。** 故事 4 验收之后，E 在 Browser 里打开 Trunk 上的 East，在 C2 输入 `Erin: Jan confirmed`（08:29:15 到 08:29:28，`s6-e-edit.png`，`s6-trunk-after-e-edit.trunk.txt`）。H 打开 Issue #2 的验收面板，点 `Review revert`，不勾选强制，撤回。

撤回计划（`s6-h-plan.png`，`s6-h-plan.txt`）列出：East `Back to before the merge`、`Edited after the merge`，说明 `Erin Editor edited it once after`，下面是一个 `Overwrite these edits` 勾选框；North 和 South `Back to before the merge`、`Ready`；Q1 summary `Move to Trash`、`Ready`；以及 `What a revert cannot undo` 的五条。H 在 08:29:40.747 打开页面，08:29:59.786 撤回完成，用了 19.0 秒（`timeline.tsv`，`s6-issue.out`）。完成后 North、South、Q1 summary 是 `Done`，East 仍是 `Edited after the merge`（`s6-h-done.png`）。

读回（`driver/s6-readback.sh`）：

- **另外两张 Sheet 回到任务之前。** North 是 Month、Revenue、120、135、150，第 5 行为空；South 是 80、86、92，第 5 行为空（`s6-trunk-after-revert.trunk.txt`），和 `s4-trunk-start.trunk.txt` 相同。
- **Doc 在 Trash 里。** 目录里没有 `Q1 summary`，`GET /api/spaces/<S>/trash` 列出它（`s6-trash.json`）。
- **E 改过的 Sheet 未撤回且不变。** East 仍有 C2 的 `Erin: Jan confirmed` 和 A 的 Total 行，修订仍是 3（`s6-revisions.txt`）。
- **恢复是新的修订。** North 和 South 的 Trunk 修订从合入后的 2 变成 3（`s6-revisions.txt`），内容等于修订 1。
- **Issue 重新打开，验收状态是 `reverted`。** Issue 时间线在 `accepted` 之后有 `reopened` 和 `reverted`，状态是 `open`（`s6-issue.out`）。
- **面板仍列出每个 pull request 的文件。** #3 列 North 和 South，#4 列 East，各有 `Compare`；#5 列 `Q1 summary`，注明 `This file is now in Trash.`，没有对比（`s6-h-panel-after.png`，`s6-h-panel-after.txt`）。三个 pull request 的 `capabilities.review` 都是 true，Unit 的 `fileState` 分别是 `live`、`live`、`inTrash`（`s6-pr-3.out` 到 `s6-pr-5.out`）。

撤回前后 `workspace_ceiling_denials_total` 没有变化。撤回之后，#5 的两项检查在面板上显示为 `Missing`，A 的结论标为 `Does not count`，见 10.2。

## 6. A6.4：故事 7，agent 之间交接，没有转达

**走通。** A3 只收到一次带任务的提示词，就是授权。它创建仓库 R `setup-principal-a3-fyyk/budget-2028`，用 pull request #1 放进 Sheet `Budget` 并合入，用 `space_node` 建 `.agents` 文件夹，用 `file_upload_create` 和 `blob_upload` 放进 `checks.md`，把 B3 加为 viewer，写 Issue #2 指派给 B3。之后 B3 和 A3 交替运行固定提示词，第一轮就完成了。

| 时间（UTC）  | 谁  | 做了什么                                            | 证据                                                |
| ------------ | --- | --------------------------------------------------- | --------------------------------------------------- |
| 08:31:26.409 | A3  | 准备运行开始，连接带 `?toolsets=all`                | `s7-a3-setup/run-meta.json`，`mcp-url-switches.txt` |
| 08:31:53.142 | A3  | `repo_create`                                       | `s7-a3-setup-events.events.jsonl`                   |
| 08:32:22.520 | A3  | 合入 #1，Trunk 上有了 `Budget`                      | 同上                                                |
| 08:32:32.728 | A3  | `blob_upload` 放进 `.agents/checks.md`              | 同上，`s7-setup-tree.json`                          |
| 08:32:39.917 | A3  | `repo_member_write` 把 B3 加为 viewer               | 同上，`s7-members.json`                             |
| 08:32:43.485 | A3  | `issue_create` 写 Issue #2 指派给 B3                | 同上，`s7-issue-initial.json`                       |
| 08:33:35.646 | B3  | 第一轮开始，固定提示词，默认 `core` 连接            | `s7-b3-r1/prompt.txt`                               |
| 08:34:15.409 | B3  | `pr_create`，`unit_add`，修改，`pr_edit` 关联 Issue | `s7-b3-r1-events.events.jsonl`                      |
| 08:35:11.582 | B3  | `pr_ready`，报告两项检查                            | 同上                                                |
| 08:35:19.554 | B3  | 提交                                                | 同上，`s7-issue-final.out`                          |
| 08:35:29.965 | A3  | 第一轮开始，固定提示词                              | `s7-a3-r1/prompt.txt`                               |
| 08:36:05.869 | A3  | 报告两项检查                                        | `s7-a3-r1-events.events.jsonl`                      |
| 08:36:08.200 | A3  | 合入 #3                                             | 同上，`s7-pr-3.json`                                |
| 08:36:14.181 | A3  | 验收，Issue 以 completed 关闭                       | `s7-issue-final.out`                                |
| 08:36:20.965 | A3  | 第一轮结束                                          | `s7-a3-r1/run-meta.json`                            |

**每个 agent 怎样找到自己的工作。** B3 的 `search` 找到指派给它的 Issue #2，它是 R 的 viewer，没有建 fork，直接用 `pr_create` 和 `unit_add` 开了一个 Team Worktree，这是 viewer 也能走的提议路径。B3 报告的检查结论不计入，它的回答也写明“因权限原因不计入合并门槛”。A3 的 `search` 找到等它验收的 Issue 和它能合入的 #3，自己重新核对并报告两项检查（计入），合入，验收。#3 的检查是 `passed 2, missing 0`，Unit 结果是 `merged`，作者是 B3（`s7-pr-3.json`）。R 的 Trunk 从修订 1 变成 2，Marketing 4000，Total `=SUM(B2:B4)` 等于 19000（`s7-trunk-after.trunk.txt`）。

**一个由 agent 写错的任务。** A3 写的 Issue 说 Total 应该“从 17500 变为 18500”，正确的是 19000。B3 没有为了凑数去覆盖公式，提交时写明了这处矛盾。A3 验收时核对了 19000 是对的，在验收说明里记下 Issue 原文算错了。

**交接的轮数。** 一轮：B3 一次，A3 一次。驱动者判断是否停下的检查写错了（`uvw issue list --json` 不接受 `acceptance` 字段），所以之后又各跑了 3 轮固定提示词。这 6 次运行都只调用了 `search`、`issue_list`、`pr_list`、`repo_list`、`whoami` 之类的读工具，回答都是没有等待处理的工作，什么都没有写（`s7-b3-r2-events.events.jsonl` 到 `s7-a3-r4-events.events.jsonl`）。它们不计入下面的数字，见 9.3。

**工具调用和拒绝。**

| 运行      | 调用 | 到达 Workspace | Workspace 的错误                                                              | `AGENT_NOT_ALLOWED` | `INTERACTIVE_SESSION_REQUIRED` |
| --------- | ---- | -------------- | ----------------------------------------------------------------------------- | ------------------- | ------------------------------ |
| A3 准备   | 69   | 25             | 1 次 `pr_check` 的 `CONFLICT`：它在已合入的 #1 上试报告检查，服务端要求 ready | 0                   | 0                              |
| B3 第一轮 | 42   | 28             | 1 次 `screenshot` 的 `workspace-argument-invalid`，把 Sheet 名当作工作表名    | 0                   | 0                              |
| A3 第一轮 | 29   | 18             | 0                                                                             | 0                   | 0                              |

`workspace_ceiling_denials_total` 在故事 7 前后没有变化（`s7-denials-delta.txt`）。

**时间。** 任务 294.6 秒，从 A3 准备运行开始到 A3 第一轮结束。三次运行共 276 秒。等人 0 秒，人的动作为零。驱动者间隔 18.6 秒（6.3%），几乎全部在准备运行和 B3 之间，是 `story` 收尾和启动下一次运行的时间。授权之后带任务内容的提示词为 0。

## 7. A6.5、A6.6、A6.8

### 7.1 A6.5：`review` 仓库里 editor agent 的合入

**和第一版相同。** H 把 A 加为 S2 的 editor（`s65-h-add-member.out`），A 用第一版故事 2 的提示词运行。它创建 fork `setup-principal-a-90ky/south-feb-revenue`，把 South 的 Feb 从 86 改成 88，读回核对，`pr_ready`，08:28:48.003 自己 `pr_merge` 成功，事件的 `principal_category` 是 `agent_claimed`（`s65-a-events.events.jsonl`）。Trunk 上 South 是 80、88、92，North 和 East 不变（`s65-trunk-after.trunk.txt`）。A 的回答写“仓库未声明额外检查项”，没有报告检查。

模型调用 35 次，到达 Workspace 20 次，全部成功，两个拒绝码三处都是 0。运行 48 秒，等人 0 秒。第一版是 53.3 秒、24 次调用、17 次到达 Workspace。

### 7.2 A6.6：按 agent 的预算

用直接的 `$V mcp` 调用，不经过模型（`driver/a66-budget.sh`，标签前缀 `a66b-`）。

- 开始时 A 的 `whoami` 是 `openWorktrees` 0/10、`merges` 6/50（`a66b-whoami-before.out`）。6 次合入是故事 4、故事 5 和 A6.5 的。
- A 在自己的 Personal Space 用 10 个不同的 Idempotency-Key 开了 10 个 pull request，`whoami` 变成 10/10（`a66b-whoami-full.out`）。
- 任务的第一步被拒绝。A 在 S 里 `pr_create` 返回 `AGENT_QUOTA_EXCEEDED`，说明是 `An agent can have at most 10 open pull requests. Merge or discard one before you open another.`，事件记为 `tool_error`、`AGENT_QUOTA_EXCEEDED`、`agent_claimed`（`a66b-over-pr-create.out`，`.event.json`）。经 fork `setup-principal-a-90ky/q1-totals` 的第一次写入同样返回 `AGENT_QUOTA_EXCEEDED`（`a66b-over-fork-write.out`）。
- `workspace_ceiling_denials_total{action="openWorktree",code="AGENT_QUOTA_EXCEEDED",principal_category="agent_claimed"}` 增加 2（`a66b-denials-delta.txt`）。
- 人不受影响。H 在 S 里 `pr_create` 成功，开出 #12，H 的 `whoami` 没有 `budget`（`a66b-h-pr-create.out`，`a66b-h-whoami.out`）。

第一次尝试（标签前缀 `a66-`）的 Idempotency-Key 短于 16 个字符，10 次填充都返回 `INVALID_INPUT`，A 没有到上限，后面的调用都成功了，留下 #9、#10、#11 三个草稿。驱动者用 `pr_discard` 丢弃了它们（`a66-cleanup-discard-*.out`），再跑第二次。

### 7.3 A6.8：迁移

在基线 `65f24e6f` 上跑 `verify-db-migration` 的第 2 步和第 4 步。这次没有改数据库，第 3 步的新矩阵不适用。

- 源码的结构对等：28 个历史 `schema.sql`（V6 到 V34，包括 `v0.4.0` 到 `v0.5.3` 的发布标签）都输出 `ok`，退出码 0（`a68-schema-parity-source.txt`）。
- 生产构建：`build:server` 成功（`a68-build-server.txt`），`--dist` 的结构对等同样 28 个 `ok`（`a68-schema-parity-dist.txt`），`test:production-import` 退出码 0，V6 到 V33 的矩阵和 Collaboration SDK 的迁移矩阵都通过（`a68-production-import.txt`）。日志里有一条 `no such table: collaboration_history_revisions` 的 `failed`，它属于矩阵里预期失败的用例，脚本最后仍输出通过。

阶段 6 的数据库改动是 V30 到 V34，都在这条链上。这个 skill 只覆盖 SQLite，PostgreSQL 的迁移本次没有跑。加入 V30 到 V34 的 #578、#580、#583、#589 和 #597 在 CI 的 `PostgreSQL product database` job 上都通过了；这个 job 跑 PostgreSQL 的测试，包括 `postgres-startup.test.ts` 从旧版本升级的用例，但不像 `verify-db-migration` 那样回放发布标签的结构。

## 8. A6.7：和第一版的对比

第一版的数字来自[第一版验收结果](acceptance-results.zh-CN.md)第 6 节。本次的数字来自 `acceptance-summary.json`。

| 1.3 的指标或 6.7 的度量                                      | 本次故事    | 第一版                                                     | 本次                                                                 |
| ------------------------------------------------------------ | ----------- | ---------------------------------------------------------- | -------------------------------------------------------------------- |
| 每个任务的人工介入次数                                       | 4（路线 B） | 故事 1（路线 A）：2，加成员和 E 合入                       | 3：加成员、写 Issue、验收，中间 0                                    |
| 每个任务的人工介入次数                                       | 5（打回）   | 没有                                                       | 3：写 Issue、打回、验收，中间 0                                      |
| 每个任务的人工介入次数                                       | 6（撤回）   | 没有                                                       | 1：撤回                                                              |
| 每个任务的人工介入次数                                       | 7（交接）   | 故事 3：认领之后 0                                         | 0                                                                    |
| 每个任务的人工介入次数                                       | A6.5        | 故事 2：1                                                  | 1                                                                    |
| 任务总时长里等人的占比                                       | 4           | 故事 1：24.1%（49.1 / 203.7 秒），是 E 合入前的评审        | 8.6%（40.9 / 473.1 秒），是合入之后的验收，Trunk 已经有改动          |
| 任务总时长里等人的占比                                       | 5           | 没有                                                       | 8.8%（47.5 / 542.9 秒）                                              |
| 任务总时长里等人的占比                                       | 7           | 故事 3：0（0 / 228.5 秒）                                  | 0（0 / 294.6 秒）                                                    |
| 任务总时长里等人的占比                                       | A6.5        | 故事 2：0（0 / 53.3 秒）                                   | 0（0 / 48 秒）                                                       |
| 中途的 `AGENT_NOT_ALLOWED` 和 `INTERACTIVE_SESSION_REQUIRED` | 全部        | 0                                                          | 0，三处计数相同                                                      |
| 转达：授权之后带任务内容的提示词                             | 7           | 故事 3：2 条，占任务时长 25.9%                             | 0                                                                    |
| 转达：授权之后带任务内容的提示词                             | 4、5        | 没有                                                       | 0                                                                    |
| 驱动者间隔                                                   | 4、5、7     | 故事 1：12.5%；故事 3 的 25.9% 即转达                      | 2.8%、9.1%、6.3%，都不带任务内容                                     |
| 验收人从打开面板到结论                                       | 4           | 没有验收页。故事 1 的 E 从打开 pull request 到合入 49.1 秒 | 40.9 秒，3 个 pull request、4 个文件、6 条检查结论                   |
| 验收人从打开面板到结论                                       | 5           | 没有                                                       | 打回 23.2 秒（1 个 pull request），验收 24.3 秒（2 个 pull request） |
| 验收人从打开面板到结论                                       | 6           | 没有                                                       | 撤回 19.0 秒，4 个文件的计划                                         |
| 验收人从打开面板到结论                                       | 7           | 没有                                                       | 验收人是 A3，不需要人                                                |

读这张表要注意三点。

- 故事 4 和第一版故事 1 不是同一条路线。故事 1 的 A 是 viewer，人在合入之前评审，等人那一段挡在改动进入 Trunk 之前。故事 4 的 A 是 `checks` 仓库里的 editor，改动在 A 的运行里就进了 Trunk，人的 40.9 秒在之后。人的动作从 2 次变成 3 次，多出来的是写 Issue，它在头部。
- 故事 4 和故事 5 的 Issue 写出了做法（见 2.3），所以它们的数字说明的是“任务和步骤都写在 Issue 里时，中间不需要人”，不说明 agent 能自己设计做法。故事 7 的 Issue 写得少，没有写关联和检查。
- 本次每个数字都只跑了一次。验收人的时间由脚本操作 Browser，包括固定的 4 秒加载和 10 秒等对比渲染，所以它更接近面板的加载时间，不是一个人读完的时间。任务时长的大部分是模型的运行时间（故事 4 是 419 / 473.1 秒），所以换模型或客户端，数字会变，表里的占比也会变。
- 故事 7 比第一版故事 3 多了 66.1 秒，因为它多做了检查文件、成员和 Issue，B3 和 A3 还要自己去找工作。省下的是转达：第一版的 59.3 秒转达，本次是 0 条带任务内容的提示词。

## 9. 没有走通或需要驱动者的

### 9.1 A3 的连接带上了 `?toolsets=all`

A6.4 要 A3 在自己的仓库里声明检查。`.agents/checks.md` 必须是 Blob，而在 MCP 网关里，建文件夹是 admin 工具集的 `space_node`，上传 Blob 是 files 工具集的 `file_upload_create` 和 `blob_upload`。agent 的默认连接是 `core`，`core` 里只多给 agent 四个 admin 工具（`repo_create`、`repo_edit`、`repo_member_list`、`repo_member_write`）。所以 A3 的每次运行，驱动者都把连接地址改成 `?toolsets=all`（`driver/a3-url.sh`，`mcp-url-switches.txt`），B3 和 A 用默认连接。这是连接的配置，不是提示词。没有它，agent 在默认连接上不能声明自己仓库的检查，只能请人或改连接。

这次运行之后，agent 的默认 `core` 连接也列出 `space_node` 和 `blob_upload`，拥有仓库的 agent 不改连接就能声明检查，不拥有 `checks` 仓库的 agent 对 Trunk 的写入仍被服务端拒绝。

### 9.2 驱动者在准备阶段重建了一次实例

第一次准备时驱动者把 S 的准备脚本跑了两次，S 里出现了重复的 Sheet 和两个 `.agents` 文件夹。那时还没有创建任何 agent。驱动者 `$V down`，删掉这次运行的目录，重新 `up`，准备脚本加了防重复的检查。本文的全部证据来自重建后的实例。

### 9.3 故事 7 多跑了 6 次

见第 6 节。驱动者的停止条件读了一个 `uvw issue list` 不支持的字段，一直读到空，所以没有在第一轮之后停下。多出的 6 次运行没有写任何东西。它们顺带说明：没有工作时，固定提示词下的 agent 什么都不做。

### 9.4 没有被隔离的部分

和第一版相同，`mcp` 客户端的 opencode `execute` 包装不能被禁止。故事 5 第一次运行里，模型在包装里调用了 `fetch('http://127.0.0.1:1/')`，得到连接失败。同一次运行后来又 `fetch` 了 Browser 的页面 `http://127.0.0.1:6101/nodes/<id>`，拿到 Vite 的 HTML 外壳，里面没有数据（`s5-a1/trajectory.txt` 第 1 行和第 27 行）。A3 的准备运行用 `fetch` 对网关的 `/mcp/files/...` 上传和下载地址发了 PUT 和 GET，这是 `blob_upload` 设计好的流程。这说明包装里的代码能访问网络，模型会用它。

### 9.5 A6.6 的第一次尝试

见 7.2。驱动者的 Idempotency-Key 太短，第一次尝试没有到达上限，留下的三个草稿由驱动者丢弃。

## 10. 已知限制和后续

### 10.1 阶段 6 的验证里发现、读这份结果时需要知道的

这些不在本次的范围里，记在这里，因为它们会改变读者对上面结果的理解。

- 撤回从 Trash 恢复的文件，面板里仍写着 “Deleted by this pull request and moved to Trash.”。
- Operation 重试不能推进一个什么都没撤回的撤回。
- 撤回返回 `201` 而 Operation 是 `failed`，只看 HTTP 状态的客户端会被误导。
- 已经不是成员的人请求对比，得到 403 或 409，泄漏一个比特；`fileState` 泄漏同一个比特。之后已修：读者打不开文件、看到的名字是 `Removed resource` 时，对比一律返回 403，`fileState` 为 null。
- 期限验收任务的饥饿只在期望上有界。
- 合入进行中切换 `landing`，不会重新判断这次合入。
- 不在根目录的 `.agents` 文件夹不受守卫。
- 受 `checks` 限制的 admin agent 仍能修改 `proposals`。之后定为有意的设计：`landing` 只限制合入和对 Trunk 的写入，不限制仓库的其他管理，见规格 6.7。
- 恢复之后，已打开的编辑器在刷新前仍显示旧内容。
- uvw daemon 打开的 Doc 在恢复之后报告一次 `COLLABORATION_PROTOCOL_ERROR`。
- CI 里 vitest 的 “Worker exited unexpectedly” 崩溃仍会出现。

### 10.2 本次运行里看到的

- **撤回之后，被撤回的 pull request 的检查显示为 `Missing`。** #5 合入时两项检查都是 `Passed`（`s4-h-panel.png`）。撤回把它新建的 Doc 移入 Trash 之后，面板上这两项变成 `Missing`，A 的结论标为 `Does not count`（`s6-h-panel-after.txt`）。原因是计入按当前的权限判断（`checkResults` 用 `mergesAs`，能合入要求能编辑每个 Unit），Trash 里的文件谁都不能编辑，于是报告者不再算能合入的人。#3 和 #4 的 Unit 还在，检查仍是 `Passed`。读者会以为这个 pull request 没有通过检查就合入了。合入守卫只判断未合入的 pull request，不受影响。之后已修复：文件在 Trash 里或已永久删除的 Unit 不再计入“能编辑全部 Unit”，结论保持计入。另外，合入在 Trunk 变化之前把检查记在合入 Operation 上，已合入的 pull request 显示这份记录，标为合入时，文件进 Trash、报告人被移除或降级都不改变它（规格 6.7）。这项记录出现之前合入的 pull request 没有记录，仍按现在的权限计算，标为现在、不是合入时。verify-uvw 的 MI16 覆盖这个场景：撤回把 Summary 移入 Trash 之后，它所在的 pull request 在面板上仍是 `Checks at merge` 两项 `Passed`。
- **验收人不是认领人时，看不到三类对外动作中的一类。** 故事 4 的 H 不是 A 的认领人，面板上“指派对象在自己 Personal Space 里开启的分享”一节对 H 只显示一句说明，告诉 H 只有指派对象和认领人能看到。面板截图在 1500 px 处截断，没有留下这一节，这句是按 `i18n.tsx` 和 `permissions.service.ts` 推断的。这是当时规格写明的可见范围，但这样的验收人判断不了这一类外泄。本次运行之后已经修改：能验收这个 Issue、又不是指派对象或认领人的读者，现在看到这一类的摘要，包括条数、每个文件的名字、类别（链接分享和它的访问级别，或 Node 授权和授予了谁）和时间，不含 Node ID、访问链接和 Resource ID，打不开文件，见规格 6.7。
- **agent 在默认连接上不能声明检查。** 见 9.1。之后 agent 的 `core` 加上了 `space_node` 和 `blob_upload`，默认连接就能声明。

## 11. 没有测到的

- 真人验收的时间。H 由脚本扮演，验收人的时间是下限。
- 期限验收（`acceptAfterHours`）和 `pr_revert`、`uvw pr revert` 的撤回。本次的撤回都在 Browser 里由人做，没有强制覆盖。
- 路线 A 下的验收，即 viewer agent 提议、人合入、再验收。故事 7 的 B3 是 viewer，但合入和验收的是 A3。
- 撤回替换过的 Blob 和页面。本次的任务没有 HTML View 和其他 Blob。
- PostgreSQL 上的迁移和这些故事。实例用 SQLite。
- 其他客户端和模型。每个故事一次走通，没有用 `#max` 或 `codex` 重跑。
- 人用 PAT 或 OAuth 授权的任务。三个 agent 都是已认领的 agent principal，用自己的 token。
