# Agent Mode 第一版验收结果

> 日期 2026-11-24。对应 [规格](spec.zh-CN.md) 6.8 第一版的完成标准，以及 1.3 的前两项指标。
> 运行基于 `main` 的 `5e4dceb3`，阶段 0 到 5 已合入。verify-uvw 的 MCP 模式，run id `p6a`。
> 证据在运行机器的 `/tmp/verify-uvw/p6a/evidence/` 下，不在仓库里。下文的文件名都相对这个目录。引用的证据都通过了 `$V secret-check`。

## 1. 结论

- **三个故事都走通了。** 每个故事只跑了一次，模型都是 `console-deepseek/deepseek-flash#high`，客户端是 `mcp`（opencode v2.0.29）。没有一次因为模型失败而重跑。
- **人的动作和 6.8 一致。** 故事 1 两次：H 加成员，E 在 Browser 里合入。故事 2 一次：H 加成员。故事 3 在认领之后为零。
- **中途没有拒绝。** 三个故事里，agent 收到的 `AGENT_NOT_ALLOWED` 和 `INTERACTIVE_SESSION_REQUIRED` 都是 0。transcript 里的工具结果、`mcp.tool_call` 事件和 `workspace_ceiling_denials_total` 三处分别计数，结果相同。所有事件的 `principal_category` 都是 `agent_claimed`。
- **Trunk 只经合入改变。** 合入之前读回的 Trunk 和任务开始时相同，合入之后才出现 agent 的修改。故事 2 里 agent 自己合入，Trunk 修订从 2 变成 3，期间只有这一个修订。
- **等人的占比。** 故事 1 是 24.1%（203.7 秒里有 49.1 秒是 E 在 Browser 里评审和合入）。E 由驱动者按脚本扮演，真人只会更久，所以这是下限。另有 25.4 秒（12.5%）是驱动者在 A1 结束后读结果、读回 Trunk，和故事 3 的转达一样单独列出，不算等人。故事 2 和故事 3 是 0。
- **故事 3 的交接靠驱动者转达。** “B 可以开始改了”和“B 提了 pull request”这两条消息，产品里没有通道送到 agent，本次由驱动者写进下一次运行的提示词。转达占任务时长的 25.9%。它不是产品里的人的动作，也不算等人，见 5.4。

## 2. 怎样复现

### 2.1 实例

```bash
V=.agents/skills/verify-uvw/bin/verify-uvw
export VERIFY_UVW_RUN=p6a VERIFY_UVW_SERVER_PORT=4009 VERIFY_UVW_WEB_PORT=6029 VERIFY_UVW_MCP_PORT=4010
VERIFY_UVW_MCP=1 $V up
$V user
$V doctor          # no FAIL lines
eval "$($V env)"
O=verify-p6a
```

`run.env` 记录的启动 HEAD 是 `5e4dceb34c139a9321bc4a2ab092e373b4e7ebfe`。驱动时用的 shell 函数在 `driver/` 下，`driver/p.sh` 设置环境，`driver/collect.sh` 取指标和事件，`driver/trunk.sh` 和 `driver/rsnap.sh` 读回 Trunk。

### 2.2 身份和数据

| 身份 | 是谁                            | 怎样来的                                                                                            |
| ---- | ------------------------------- | --------------------------------------------------------------------------------------------------- |
| H    | 运行用户 `verify-p6a`           | `$V user`。S 的 owner                                                                               |
| E    | 人 `verify-p6a-editor`          | 按 `features/mcp-html-view.md` MHV8 的方式注册，`uvw` 在自己的 home 里登录。S 的 editor，B 的认领人 |
| C    | 人 `verify-p6a-claimer`         | 同上。A1、A2、A3 的认领人                                                                           |
| A1   | agent `setup-principal-a1-ohif` | `$V principal a1 setup-principal-a1`，故事 1 的 A                                                   |
| A2   | agent `setup-principal-a2-2tht` | 同上，故事 2 的 A                                                                                   |
| A3   | agent `setup-principal-a3-fcvk` | 同上，故事 3 的 A                                                                                   |
| B3   | agent `setup-principal-b3-xg8h` | 同上，故事 3 的 B                                                                                   |

和规格 6.3 的设定对照：

- 规格说 H 是 S 的 admin。本次 H 是 S 的 owner，owner 的能力包含 admin。这是唯一的差别。
- 规格要求 A 由 H 以外的人认领。本次 A1 到 A3 由 C 认领，E 不是 A1 的认领人，所以 E 的合入走的是“可见性是 `space`、角色是 editor”这一条，而不是认领人那一条。

四个 agent 用掉每小时 5 个的创建配额中的 4 个。认领是准备工作：`$V mcp --as <name> setup-claim-<name> claim '{}'` 拿到 claim link，再用认领人的 Browser 登录会话 `POST /api/agents/claim`。证据里的 claim code 已经替换成 `<claim-code-used>`。

S 是 H 的私有 Team Space `verify-p6a/sales`，`proposals` 是 `members`。准备时 H 用一个 pull request 放进三张 Sheet：North（120、135、150）、South（80、86、92）、East（100、110、105），A 列是 Month，B 列是 Revenue，见 `setup-after.trunk.txt`。E 在准备时被加为 editor（`setup-e-member.out`）。

```bash
$V cli setup-s-create repo create sales --name "Sales 2026" --json
$V cli setup-e-member repo member add "$O-editor" --role editor -R "$O/sales" --json
$V cli setup-pr pr create -R "$O/sales" -t "Q1 sales data" --json
# unit create, execute, pr ready, pr merge: setup-unit-*, setup-data-*, setup-ready, setup-merge
```

### 2.3 三个故事

提示词逐字如下，也在每个故事目录的 `prompt.txt` 里。提示词只说任务，不提工具名，也不提遇到拒绝时怎么办。仓库地址和 agent 的用户名是一个人交代任务时会说的名字。

```bash
# Story 1
$V cli s1-h-add-member repo member add setup-principal-a1-ohif --role viewer -R "$O/sales" --json
$V story --as a1 s1-a mcp '我把你加进了仓库 verify-p6a/sales。请在你自己的 fork 里完成这件事：North、South、East 三张表各在数据下面加一行 Total，用公式算出 Revenue 的合计；再新建一个 Doc，叫 Q1 summary，写出三个地区 Q1 的 Revenue 合计和总计。做完后提交给仓库成员评审。'
# E, in its own agent-browser session: open /spaces/<S>/pulls/2, Files changed, Confirm merge, confirm the dialog

# Story 2
$V cli s2-h-add-member repo member add setup-principal-a2-2tht --role editor -R "$O/sales" --json
$V story --as a2 s2-a mcp '我把你加进了仓库 verify-p6a/sales。South 表里 Feb 的 Revenue 录错了，应该是 88。请在你自己的 fork 里改正，核对改对了，然后直接合入。'

# Story 3
$V story --as a3 s3-a-create mcp '建一个新仓库，名为 budget-2027。在里面放一张 Sheet，叫 Budget，列出 Rent 3000、Salaries 12000、Marketing 2500 三项预算，最后一行用公式算 Total。然后把 agent setup-principal-b3-xg8h 加进这个仓库，只给读权限。'
$V story --as b3 s3-b-propose mcp 'setup-principal-a3-fcvk 把你加进了它的仓库 setup-principal-a3-fcvk/budget-2027。请在你自己的 fork 里把 Budget 表里 Marketing 的预算改成 4000，核对 Total 也跟着变了，然后提交给仓库的 owner 评审。'
$V story --as a3 s3-a-merge mcp 'setup-principal-b3-xg8h 在你的仓库 budget-2027 提了一个 pull request。请评审它，改动没问题就合入。'
```

每个故事前后各取一次 `$V metrics`（`s<n>-metrics-before.prom`、`s<n>-metrics-after.prom`），合入前后各读一次 Trunk（`*.trunk.txt`）。S 由 H 用 `uvw inspect range --trunk` 读，R 由 A3 的认领人 C 读。

### 2.4 怎样计数和计时

- **人的动作。** 驱动者每做一个人的动作，就在 `timeline.tsv` 里写一行带时间的记录。把任务交给 agent 的提示词不算人的动作，6.8 也只列加成员和合入。认领是准备工作。
- **工具调用。** `<label>/trajectory.txt` 列出模型的每一次调用，包括 opencode 自己的 `search` 和 `execute` 包装。网关的 `mcp.tool_call` 事件由 `$V mcp-logs` 按 agent 的 `user_id` 和故事的时间窗筛出，存为 `<label>-events.events.jsonl`，汇总在 `<label>-events.events-summary.json`。
- **拒绝。** 三处分开数：`mcp.tool_call` 事件的 `error_code`；transcript 里工具结果中的 `"code":"AGENT_NOT_ALLOWED"` 和 `"code":"INTERACTIVE_SESSION_REQUIRED"`；`workspace_ceiling_denials_total` 在故事前后的差。工具说明文字里也出现这两个错误码，那些不算。
- **任务时长。** 从第一次 agent 运行开始（`run-meta.json` 的 `started_at`），到合入和最后一次 agent 运行结束两者中较晚的一个。合入时间取 Space activity 的 `pull-merged`，故事 2 取 `pr_merge` 事件。
- **等人。** agent 的运行结束之后、人合入之前，任务只能靠人推进，这一段算等人。故事 1 的这一段包括驱动者读结果的时间和 E 评审的时间，都按实测记，没有加进真人评审会多花的时间。agent 在一次运行里自己做的验证不算等人。
- `acceptance-summary.mjs` 从上面这些文件算出每个故事的数字，写进 `acceptance-summary.json`。

## 3. 故事 1：上游只给读权

**走通。** A1 在 S 里是 viewer。它创建 fork `setup-principal-a1-ohif/q1-summary`，改了三张 Sheet，新建 Doc `Q1 summary`，提议成 pull request #2。E 在 Browser 里评审并合入。

| 时间（UTC）  | 谁     | 做了什么                                                  | 证据                                                        |
| ------------ | ------ | --------------------------------------------------------- | ----------------------------------------------------------- |
| 12:27:53.733 | H      | 把 A1 加为 S 的 viewer，人的动作 1                        | `s1-h-add-member.out`，`timeline.tsv`                       |
| 12:28:02.599 | A1     | 开始运行                                                  | `s1-a/run-meta.json`                                        |
| 12:28:55.024 | A1     | `fork_create`                                             | `s1-a-events.events.jsonl`                                  |
| 12:28:57.820 | A1     | 第一次写入经 fork 打开 pull request #2                    | `s1-activity.json` 的 `pull-opened`                         |
| 12:29:58.354 | A1     | `pr_ready`，可见性变为 `space`                            | `s1-a-events.events.jsonl`，`s1-pr-before-merge.out`        |
| 12:30:11.840 | A1     | 运行结束                                                  | `timeline.tsv`                                              |
| 12:30:37.213 | E      | 在 Browser 里打开 pull request，看 Files changed 和新 Doc | `s1-e-review.png`，`s1-e-files-changed.png`，`s1-e-doc.png` |
| 12:31:23.463 | E      | 在确认对话框里合入，人的动作 2                            | `s1-e-merge-dialog.png`                                     |
| 12:31:26.337 | 服务端 | 合入完成，`pull-merged` 的 actor 是 E                     | `s1-activity.json`，`s1-e-merged.png`                       |

**工具调用和拒绝。** 模型调用了 65 次，其中 39 次到达 Workspace（`s1-a/trajectory.txt`，`s1-a-events.events-summary.json`）。`AGENT_NOT_ALLOWED` 和 `INTERACTIVE_SESSION_REQUIRED` 在事件、transcript 结果和 ceiling 计数器里都是 0（`acceptance-summary.json`，`s1-a-transcript-refusals.txt`，`s1-denials-delta.txt`）。有 5 次别的错误，都来自 `screenshot`：4 次 `workspace-argument-invalid`，因为 idempotency key 短于 16 个字符；1 次 `workspace-renderer-busy`，因为模型同时发了 4 张截图。模型换了 key、重试，都成功了。模型从 `repo_list` 读到自己在 S 里是 `viewer`，最后的回答说“我这边是 viewer 权限，已按你的要求交给仓库成员评审和合并”。

**Trunk。** 任务开始时（`s1-trunk-start.trunk.txt`）和合入前（`s1-trunk-before-merge.trunk.txt`）的目录和三张 Sheet 的 A1:D10 完全相同，只有三张 Sheet，第 5 行是空的。合入后（`s1-trunk-after-merge.trunk.txt`）目录多了 `/Q1 summary`，三张 Sheet 的第 5 行是 `Total` 和 `=SUM(B2:B4)`，值分别是 405、258、315。Trunk 上的 Doc 有一张表：North 405，South 258，East 315，Total 978（`s1-trunk-doc-after.out`）。pull request 的四个 Unit 结果都是 `merged`，作者是 A1（`s1-pr-after-merge.out`）。

**时间。** 任务 203.7 秒，A1 运行 129.2 秒。等人 49.1 秒，占 24.1%，是 E 在 Browser 里评审和合入的时间。A1 结束到 E 合入共 74.5 秒（`acceptance-summary.json`），其余 25.4 秒（12.5%）是驱动者读完 A1 的结果、读回 Trunk 之后才让 E 打开页面。这一段和 5.4 的转达一样单独列出，不算等人。

## 4. 故事 2：上游允许 agent 自己合入

**走通。** A2 在 S 里是 editor。它创建 fork `setup-principal-a2-2tht/south-feb-revenue-fix`，把 South 的 Feb 从 86 改成 88，读回核对，`pr_ready` 之后自己 `pr_merge`，合入的是 pull request #3。

| 时间（UTC）  | 谁  | 做了什么                                                        | 证据                                                |
| ------------ | --- | --------------------------------------------------------------- | --------------------------------------------------- |
| 12:32:41.234 | H   | 把 A2 加为 S 的 editor，人的动作 1                              | `s2-h-add-member.out`，`timeline.tsv`               |
| 12:32:47.120 | A2  | 开始运行                                                        | `s2-a/run-meta.json`                                |
| 12:33:04.472 | A2  | 读 Trunk 上的 South，修订 2，Feb 是 86                          | `agent-read-revisions.txt`                          |
| 12:33:07.829 | A2  | `fork_create`                                                   | `s2-a-events.events.jsonl`                          |
| 12:33:22.193 | A2  | 读 fork 里的 South，Feb 是 88，Total 是 260                     | `agent-read-revisions.txt`，`s2-a/trajectory.txt`   |
| 12:33:32.675 | A2  | `pr_ready`，可见性保持 `private`，因为作者自己能合入            | `s2-a-events.events.jsonl`，`s2-pr-after-merge.out` |
| 12:33:32.819 | A2  | `pr_merge` 成功，事件的 `principal_category` 是 `agent_claimed` | `s2-a-events.events.jsonl`                          |
| 12:33:35.432 | A2  | 读回 Trunk，修订 3，Feb 是 88                                   | `agent-read-revisions.txt`                          |
| 12:33:40.452 | A2  | 运行结束                                                        | `timeline.tsv`                                      |

**工具调用和拒绝。** 模型调用了 24 次，其中 17 次到达 Workspace，全部成功。两个拒绝码三处都是 0。轨迹里的 3 行 `error` 是两次尝试，都没有到达 Workspace。一次是 `fork_create` 把 `repo` 写成了 `space`，被 opencode 按工具的 schema 拒绝，这次调用和包着它的 `execute` 各占一行。另一次是模型在 opencode 自己的 `execute` 包装里试图 `import('node:child_process')`，被包装的受限解释器拒绝。

**Trunk。** 任务开始时 South 是 80、86、92，Total 258（`s2-trunk-start.trunk.txt`）。A2 在写 fork 之前读到的 Trunk 修订是 2，合入之后是 3（`agent-read-revisions.txt`，`s2-trunk-outline-after.out`），期间 Trunk 只有合入这一个修订。合入后 South 是 80、88、92，Total 260，North 和 East 不变（`s2-trunk-after-merge.trunk.txt`）。

**时间。** 任务 53.3 秒，等人 0 秒。

## 5. 故事 3：agent 持有的仓库里，agent 之间协作

**走通。** A3 创建仓库 R `setup-principal-a3-fcvk/budget-2027`，放进 Sheet `Budget` 并自己合入，把 B3 加为 viewer。B3 创建 fork `setup-principal-b3-xg8h/budget-2027`，把 Marketing 从 2500 改成 4000，提议成 pull request #2。A3 评审，合入。

### 5.1 时间线

| 时间（UTC）  | 谁  | 做了什么                                           | 证据                                                          |
| ------------ | --- | -------------------------------------------------- | ------------------------------------------------------------- |
| 12:34:55.615 | A3  | 第一次运行开始                                     | `s3-a-create/run-meta.json`                                   |
| 12:35:15.568 | A3  | `repo_create`                                      | `s3-a-create-events.events.jsonl`                             |
| 12:35:17.967 | A3  | `repo_member_write` 把 B3 加为 viewer              | 同上，`s3-members-after-part1.json`                           |
| 12:35:47.163 | A3  | 合入自己的 pull request #1，Trunk 上有了 `Budget`  | `s3-activity.json`，`s3-trunk-after-part1.trunk.txt`          |
| 12:35:58.339 | A3  | 第一次运行结束                                     | `timeline.tsv`                                                |
| 12:36:36.255 | B3  | 运行开始                                           | `s3-b-propose/run-meta.json`                                  |
| 12:36:55.363 | B3  | `fork_create`                                      | `s3-b-propose-events.events.jsonl`                            |
| 12:37:21.268 | B3  | 第一次写入经 fork 打开 pull request #2             | `s3-activity.json`                                            |
| 12:37:45.067 | B3  | `pr_ready`，可见性变为 `space`                     | `s3-b-propose-events.events.jsonl`，`s3-pr-before-merge.json` |
| 12:37:49.099 | B3  | 运行结束                                           | `timeline.tsv`                                                |
| 12:38:10.447 | A3  | 第二次运行开始                                     | `s3-a-merge/run-meta.json`                                    |
| 12:38:40.648 | A3  | 合入 pull request #2，`pull-merged` 的 actor 是 A3 | `s3-activity.json`                                            |
| 12:38:44.131 | A3  | 第二次运行结束                                     | `timeline.tsv`                                                |

### 5.2 工具调用和拒绝

| 运行    | 调用 | 到达 Workspace | Workspace 的错误                                        | `AGENT_NOT_ALLOWED` | `INTERACTIVE_SESSION_REQUIRED` |
| ------- | ---- | -------------- | ------------------------------------------------------- | ------------------- | ------------------------------ |
| A3 创建 | 53   | 20             | 1 次 `browse` 的 `workspace-argument-invalid`，重试成功 | 0                   | 0                              |
| B3 提议 | 31   | 17             | 0                                                       | 0                   | 0                              |
| A3 合入 | 15   | 11             | 0                                                       | 0                   | 0                              |

调用数来自各自的 `trajectory.txt`，其余来自 `<label>-events.events-summary.json` 和 `<label>-transcript-refusals.txt`。`workspace_ceiling_denials_total` 在故事 3 前后没有变化（`s3-denials-delta.txt`）。A3 创建运行的轨迹里还有 4 次 `error`，是 opencode 的 `execute` 包装把 4 个调用放进同一个 `Promise.all`，其中 `browse` 失败，包装就整体报错。B3 运行的 4 次 `error` 都是 opencode 自己的 `execute` 包装，没有到达 Workspace。

### 5.3 Trunk

R 的 Trunk 由 A3 的认领人 C 读回。A3 的第一次运行之后（`s3-trunk-after-part1.trunk.txt`）和 A3 合入之前（`s3-trunk-before-merge.trunk.txt`）相同：修订 1，Marketing 2500，Total `=SUM(B2:B4)` 等于 17500。合入之后（`s3-trunk-after-merge.trunk.txt`）是修订 2，Marketing 4000，Total 19000。pull request #2 的作者是 B3，Unit 结果是 `merged`（`s3-pr-after-merge.json`）。

### 5.4 时间和交接

任务 228.5 秒，从 A3 第一次运行开始到第二次运行结束。三次 agent 运行共 169.2 秒。等人 0 秒，认领之后没有人的动作。

两次运行之间的 59.3 秒（25.9%）是驱动者在转达：第一次 37.9 秒，第二次 21.3 秒，期间驱动者读结果、读回 Trunk、启动下一次运行。B3 要知道自己被加进了 R，A3 要知道 B3 提了 pull request，产品里都没有通知 agent 的地方，所以这两条消息写在了 B3 和 A3 第二次运行的提示词里。按 6.8 的定义它们不是人的动作。如果没有驱动者，就要由人或者 agent 所在的外部调度来转达。

## 6. 和阶段 0 基线的对比

基线来自 [阶段 0 结果](phase-0-results.zh-CN.md) 第 10 节。

| 1.3 的指标             | 故事                       | 阶段 0 基线                                               | 本次结果                                                                        | 证据                      |
| ---------------------- | -------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------- |
| 每个任务的人工介入次数 | 1                          | 走不完。第一步 `addTeamMember` 返回 `AGENT_NOT_ALLOWED`   | 2：头部加成员，尾部合入，中间 0                                                 | `timeline.tsv`            |
| 每个任务的人工介入次数 | 2                          | 走不完。第一步 `addTeamMember` 返回 `AGENT_NOT_ALLOWED`   | 1：头部加成员，中间和尾部 0                                                     | `timeline.tsv`            |
| 每个任务的人工介入次数 | 3                          | 走不完。第一步 `createTeamSpace` 返回 `AGENT_NOT_ALLOWED` | 认领之后 0                                                                      | `timeline.tsv`            |
| 每个任务的人工介入次数 | 人用 PAT 交给 agent 的任务 | 网关的说明文字把 ready 和合入留给人，中途至少 1 次        | 本次没有测                                                                      |                           |
| 任务总时长里等人的占比 | 1                          | 产品里没有记录                                            | 24.1%（49.1 / 203.7 秒），E 由驱动者按脚本扮演，是下限。另有 12.5% 是驱动者延迟 | `acceptance-summary.json` |
| 任务总时长里等人的占比 | 2                          | 产品里没有记录                                            | 0（0 / 53.3 秒）                                                                | `acceptance-summary.json` |
| 任务总时长里等人的占比 | 3                          | 产品里没有记录                                            | 0（0 / 228.5 秒），另有 25.9% 是驱动者转达                                      | `acceptance-summary.json` |

1.3 的第三项也有了数字：三个故事里 agent 收到的 `AGENT_NOT_ALLOWED` 和 `INTERACTIVE_SESSION_REQUIRED` 都是 0。阶段 0 时，故事 1 和故事 2 停在 H 的 `addTeamMember`，agent 还没有开始；故事 3 的 agent 第一步就收到 `AGENT_NOT_ALLOWED`。这一项的另一半，agent 读一次 `capabilities` 就知道能走到哪一步，本次没有单独测。

## 7. 没有测到的

- 真人评审的等待时间。故事 1 的 E 由驱动者扮演，49.1 秒是脚本操作 Browser 的时间。真人会花多久，本次测不到。
- agent 之间的交接。故事 3 由驱动者转达，产品没有通知 agent 的通道，所以“没有驱动者时交接要多久”没有数字。
- 人用 PAT 或 OAuth 授权的任务。三个故事的 agent 都是已认领的 agent principal，用自己的 token。阶段 1 改过的人的 token 会话（A1.1、A1.2）本次没有走。
- 部署环境上的 `workspace_ceiling_denials_total` 和 `mcp.tool_call`。本次读的是隔离实例，计数只来自这三个故事和准备工作。
- 其他客户端和模型。三个故事只用了 `mcp` 客户端和 `console-deepseek/deepseek-flash#high`。它们一次走通，所以没有按约定用 `#max` 或 `codex` 重跑。
- 同一个仓库里多个 fork 并行、落后距离大于 0 时的合入、部分冲突，以及 HTML View 和其他 Blob。三个故事都没有涉及。被修改的 Unit 的 `freshness` 都是 `current`，故事 1 新加的 Doc 是 `null`（`s1-pr-before-merge.out`）。
- 故事 2 合入的 pull request 是 `private`，因为作者自己能合入。H 作为 S 的 owner 读这个 pull request 时 `units` 为空（`s2-pr-after-merge.out`），E 读 S 的 activity 也看不到 #3（`s2-activity.json`）。人事后怎样看到 agent 自己合入了什么，本次只记录了这个现象，没有评估。这个现象之后按缺陷修复：合入完成的 Team Worktree 读作 `space`，Space Member 都能看到它和它的合入，见规格 I4。
