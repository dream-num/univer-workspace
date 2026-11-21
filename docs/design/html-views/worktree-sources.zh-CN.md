# 来源 Sheet 还在 PR 里时，Agent 做不了页面：复现与改进策略

状态：方案已定（2026-11-21），按 S1、S2 顺序实现。复现基于 `b836dff0`。

## 1. 结论

用户让 Agent 做一个页面，Agent 回复：

> 必须合并的原因很具体：HTML 页面只能绑定主干数据，我刚用真实 ID 试了一次校验，返回 403 Cannot read this unit
> （文件还在 worktree 里，主干上取不到）。

Agent 说的是事实，不是幻觉。按现在的设计，HTML View 的校验、草稿预览和发布后的运行时都只读 trunk。
浏览器 Agent 在 Auto mode 下必须先 `pr_create`，新建的 Sheet 只存在于 PR 的 Worktree 里，
于是 `html_view_validate` 必然失败。Agent 又不能合并 PR，只能停下来让人去合并。

问题不在那次 403，而在流程本身走不通。复现中还发现一个更隐蔽的情况：来源是 trunk 上已有的 Sheet、
改动在 PR 里时，校验**照样通过**，返回的样本却是 trunk 上的旧值，Agent 和用户都看不出来。

复现里有一个关键事实：Worktree 里新建的 Unit 合并后 unitId 和 worksheet ID 都不变，
同一份 HTML 合并后原样校验通过。所以页面的绑定身份不需要改，需要改的只是"校验和预览读哪个 scope"。

我的建议是分两步：

- **先做 S1（提示与报错）。** 让 Agent 在来源还在 PR 里时不去撞 403，用用户听得懂的话说明下一步，
  并发现"改动在 PR 里、校验读到旧值"的情况。改动只在 Skill 文本和一处错误映射。
- **再做 S2（按 PR 校验和预览草稿）。** 校验和草稿预览可以读 PR 里的数据，发布仍然等 PR 合并。
  用户可以同时评审 PR 和页面，合并后点一次发布。这是本文推荐的目标方案，需要你对第 6 节的问题拍板。

## 2. 复现

### 2.1 环境与步骤

在隔离实例（`verify-uvw`，run `hvwt`，端口 3940/5990，launch HEAD `b836dff0`）里用源码构建的 `uvw` 走一遍。
脚本见附录。步骤和结果：

| 步骤 | 操作 | 结果 |
| --- | --- | --- |
| A1 | `pr create`，在 PR 里 `unit create --type sheet`，写入 `B2 = 5` | 成功，unitId `f7ec6345…` |
| A2 | 写一个绑定 `B2` 的页面，`html-view validate` | **失败**，`403 Cannot read this unit.`，请求路径 `/universer-api/snapshot/2/unit/f7ec6345…/rev/0` |
| A3 | `pr ready`、`pr merge` | 成功 |
| A4 | 同一份 HTML 再次 `html-view validate` | 通过，样本 `B2 = 5`，unitId 与 A1 相同 |
| B1 | 新开 PR，`unit add` 把这张 Sheet 加进去，把 `B2` 改成 42，并新建工作表 `Forecast` | 成功，`inspect --worktree` 读到 42 |
| B2 | 用 A2 的页面再次校验 | **通过**，但样本是 `B2 = 5`（trunk 旧值），不是 PR 里的 42 |
| B3 | 写一个绑定 `Forecast!A1` 的页面并校验 | **失败**，`Source worksheet not found: lfej6ssk0gwCNNk5kZJ5B` |

A2 就是用户报告的现象。B2 是这次复现新发现的：校验不报错，Agent 会拿旧数据去规划页面。

### 2.2 复现覆盖的范围

我只跑了 CLI，没有起 MCP 网关。浏览器 Agent 走 MCP，但 MCP executor 的 `htmlView.validate`
（`apps/mcp/src/executor/ops/html-view.ts:7-25`）构造的是同一个 `WorkspaceHtmlViewFeature`，
注入的也是同一个 `resolveTrunkRuntimeTarget`，所以两条路径的结果相同。这一点是读代码得出的，没有在 MCP 上实测。

没有复现模型行为。用户看到的那句回复是模型在 403 之后的自然推理，下文第 3.3 节解释了它为什么只能这样说。

## 3. 为什么会这样

### 3.1 校验只读 trunk

`html_view_validate` 和 `html_view_create` 都调用 client-core 的 `readAndValidate`
（`packages/client-core/src/html-view.ts:243-319`）。它对页面里的每个 unitId 做三件事：

1. 用 `resolveTrunkRuntimeTarget` 解析目标（`html-view.ts:259`），scope 不是 trunk 就报错（`html-view.ts:260`）。
2. 用 `exportUnitData` 从 trunk 快照读出整张表。
3. 检查工作表存在、绑定没有越界，再抽样前 60 个绑定的值。

`resolveTrunkRuntimeTarget`（`packages/client-core/src/runtime-source.ts:57-81`）请求 trunk 快照。服务端在
`requireUnitAccess`（`apps/workspace/server/src/integrations/univer/collaboration-gateway.ts:549-558`）里调用
`access.resolveUnitContent`，它按 unitId 查产品库的 Resource 行。Worktree 里新建的 Unit 在合并前只有
`worktree_units` 里预留的 Resource ID，`resources` 表还没有这一行（`apps/workspace/docs/data-model.md` 的
`worktree_units` 一节），于是返回 `PERMISSION_DENIED`，HTTP 层是 403。

对 trunk 上已有的 Sheet，trunk 读当然成功，PR 里的改动根本不在读取范围内，这就是 B2 拿到旧值的原因。

### 3.2 预览和运行时也只读 trunk

即使跳过校验，草稿也看不到 PR 里的数据：

- Browser 的绑定引擎把 scope 写死为 trunk：`snapshotServerUrl: "/universer-api/snapshot"`、
  `hostScope: { kind: "trunk" }`，合并预览直接抛出 `HTML view sources only support trunk.`
  （`apps/workspace/web/src/features/html-views/workspace-binding-engine.ts:48-67`）。
- `/drafts/{id}` 渲染的是同一个 `HtmlView`，`draft` 只关掉编辑，不改 scope。
- 草稿记录（`apps/workspace/server/src/modules/html-view-drafts/drafts.types.ts`）只保存 Space、父节点、名称、
  Blob 和状态，没有任何 PR 或 Worktree 字段，也没有合并后重新校验的机制。

这些都是有意的设计，文档里写过多次：`docs/design/html-views/README.md:31`、`agent-integration.md:42`、
`native-preview.md:113-114`。

反过来，读 PR 里数据的能力其实都已经有了：

- client-core 有 `resolveRuntimeTarget({ unitId, worktreeId })` 和 `resolveReferencedRuntimeTarget`
  （`runtime-source.ts:35`、`:83-95`）。后者的规则正好是"Unit 在这个 Worktree 里就读 Worktree，否则读 trunk"。
- 服务端的 Worktree 协议路径走 `requireWorktreeProtocolAccess` → `worktrees.authorizeProtocol`，
  能评审这个 Worktree 的人就能读其中新建的 Unit。复现的 A1 和 B1 已经通过这条路径读写成功。
- Browser 编辑器在 `collaboration-editor.tsx` 的 `resolveCollaborationConfig` 里已经按 trunk、Worktree、
  合并预览三种 scope 连协同服务。HTML 绑定引擎所在的 `packages/workspace-html-viewer` 本身不关心 scope，
  只透传 `collaborationClientConfig`。

### 3.3 Agent 被提示词推进死路

浏览器 Agent 在 Auto mode 下读到的规则是：

- `runner.ts:67`："put file edits in one pull request. Call pr_create before the first file edit … Pages (.univer.html)
  are drafts outside pull requests … Never merge; a person reviews and merges."
- `apps/mcp/src/gateway/instructions.ts:61`："Every change to Unit files goes through a pull request (a Worktree)"。
- `apps/mcp/skills/core/SKILL.md:215`："For a new Unit file, create the Worktree first."
- 令牌只有 `read` 和 `write`（`apps/workspace/web/src/features/agents/mcp-token.ts:5`），没有 `worktree:merge`。
  `approvals.ts:38` 会直接拒绝合并："The browser Agent cannot merge pull requests. A person must review and merge."

用户说"把这些数据做成一个页面"，而数据还不在 Workspace 里时，Agent 只能先开 PR、在 PR 里建 Sheet、
写入数据，然后进入 html-view-creator 的第 4 步调用 `html_view_validate`。

`apps/mcp/skills/html-view-creator/SKILL.md` 里没有出现 Worktree、merge 或 PR 这些词，
也没有说校验返回 403 时怎么办。工具描述只说"against trunk Sheets"。所以 Agent 先撞了一次 403，
才推理出"必须合并"。

同一件事在三份 Skill 里写法互相矛盾：

| Skill | 来源只在 Worktree 里时怎么做 |
| --- | --- |
| CLI `apps/cli/skill-data/html-view/SKILL.md:44-48` | 准备模板，推迟校验和发布到合并之后；不要自动合并 |
| DSH `packages/dsh-univer-workspace-plugin/skills/univer-html-view/SKILL.md:29-49` | 请用户授权 Agent 合并，"不要让用户自己去合并"，然后 Agent 用 `univer_worktree` 合并 |
| MCP `apps/mcp/skills/html-view-creator/SKILL.md` | 没有写 |

浏览器 Agent 读的是最后一份。它得出的"让人去合并"恰好和 DSH Skill 的要求相反，又恰好符合浏览器 runtime 的规则。

## 4. 对用户意味着什么

对做页面的用户，现在的路径是：

1. 让 Agent 做页面。
2. Agent 建好 PR 和 Sheet，撞 403，解释一段技术原因，让用户去合并。
3. 用户打开 PR，评审 Sheet，合并。此时还没见过页面长什么样。
4. 回到会话，告诉 Agent 继续。Agent 校验、保存草稿。
5. 用户打开草稿预览，满意后发布。

用户在第 3 步评审的是一张孤立的表，看不到它要服务的页面。如果页面在第 5 步发现数据结构不对，
就要再开一个 PR 改 Sheet，再合并一次。第 2 步的 403 和"主干""worktree"这些词，对不是开发者的用户没有意义。

对改已有 Sheet 的用户，问题更严重。Agent 在 PR 里加了一列，然后基于 trunk 的旧结构校验页面，
样本里看不到新列，绑定新列的页面要么报 `Source worksheet not found`，要么按旧数据规划布局。
Skill 写着"Do not silently substitute older trunk content"，但工具不给 Agent 发现这件事的手段。

对维护代码的人，三份 Skill 各说各的，修一份不会修好另外两份。

## 5. 改进策略

### 5.1 候选方案

| 方案 | 做法 | 用户体验 | 改动面 |
| --- | --- | --- | --- |
| S0 维持现状 | 不改 | 第 4 节的五步，含一次无意义的 403 | 无 |
| S1 提示与报错 | html-view-creator 增加"来源在 PR 里"的分支，校验前先判断；client-core 把 trunk 上读不到来源的错误换成可行动的说明；统一三份 Skill 的说法 | 少一次 403，Agent 用平白的话让用户合并；能发现"改动在 PR 里"的旧值问题。仍然要先合并才能看到页面 | 小：Skill 文本、一处错误映射、测试 |
| S2 按 PR 校验和预览 | 校验和草稿接受可选的 PR；PR 里的 Unit 读 Worktree，其余读 trunk。草稿记住来源 PR，预览读 PR 数据；PR 合并后才能发布，PR 被丢弃则草稿失效 | 用户同时评审 Sheet 和页面，合并后点一次发布。发布后的页面仍只读 trunk | 中：client-core、MCP 工具参数、草稿表加一列（数据库迁移）、HTTP contract、绑定引擎的预览 scope、发布前检查 |
| S3 页面进 PR | HTML Blob 也进入 Worktree，与来源一起评审、一起合并 | 最完整：合并即上线 | 大：Blob 第一版不进 Worktree（`data-model.md`），涉及协同和产品数据模型。`browser-agents-page-drift.zh-CN.md` 已判定超出范围 |
| S4 让 Agent 合并 | 像 DSH 那样，请用户授权后由 Agent 合并 | 少一次跳转 | 小，但要给浏览器 Agent `worktree:merge`，违反"每次写入都由人评审"的产品承诺 |

S4 我不建议。浏览器 Agents 的设计（`docs/design/workspace-agents.zh-CN.md:295`）明确"合并只能由人在 PR 页面完成"，
为了做页面放开合并，等于让 Agent 绕过它自己的评审。

S3 是最终形态的候选，但它要回答 Blob 版本、冲突与合并语义，这次不展开。S2 不把 Blob 放进 Worktree，
只让草稿记住"它的来源在哪个 PR"，以后如果做 S3，这一列和预览 scope 都能沿用。

### 5.2 推荐：先 S1，再 S2

S1 的成本低，不依赖任何产品决定，而且 S2 上线后它的大部分内容仍然成立（报错更清楚、三份 Skill 一致）。
S2 才真正消除"先合并才能看到页面"的绕路。

#### S1 的具体做法

1. **html-view-creator 增加分支。** 第 2 步读数据时，如果来源 Unit 在本会话的 PR 里（Agent 刚用 `unit_create`
   建的，或用 `unit_add` 加进去改过的），不调用 `html_view_validate`。Agent 用 PR 里的 unitId 和 worksheet ID
   写好页面（合并后这些 ID 不变，见 2.1 的 A4），然后对用户说清楚下一步，例如：
   "页面已经写好，它要用的表还在 PR #3 里。请在 PR 页面审阅并合并，然后回来告诉我'继续'，我再检查页面并保存草稿。"
   不出现 403、trunk、worktree 这些词。
2. **改动在 PR 里的已有 Sheet。** 同一分支覆盖这种情况：页面依赖 PR 里的改动时，同样等合并，不用 trunk 旧值规划页面。
   只依赖 trunk 上已有数据的页面照常校验。
3. **报错可行动。** `readAndValidate` 在 trunk 上读不到来源时，返回专门的错误码（例如
   `workspace-html-view-source-unavailable`），消息说明三种可能：Unit 不存在、没有读权限、只存在于未合并的 PR 中。
   client-core 区分不了后两种（合并前的 Unit 在 `/api/unit-resources/{unitId}` 同样查不到），所以只列出可能，不猜。
4. **统一 Skill。** CLI、MCP、DSH 三份 Skill 对"来源只在 PR 里"用同一套说法。DSH 的"请用户授权 Agent 合并"
   是 DSH 自己的产品选择，可以保留，但要写明它只适用于持有合并权限的客户端。

S1 的验收：附录脚本的 A2 返回新的错误码和说明；在 `verify-uvw` 里用真实模型跑"把这些数据做成一个页面"
（数据不在 Workspace 里），Agent 不调用 `html_view_validate`，直接说明要先合并。

#### S2 的具体做法

数据形状先定下来：

- 校验与草稿的输入多一个可选的 `worktreeId`（MCP 工具参数叫 `pr`，与其他工具一致）。
- 来源解析规则只有一条：Unit 在这个 Worktree 里就读 Worktree，否则读 trunk。这正是现有
  `resolveReferencedRuntimeTarget` 的规则。
- 草稿表加一列 `source_worktree_id`，可空。为空时行为与今天完全相同。
- 草稿状态沿用现有的 `pending | published | rejected | expired | conflicted`，不加新状态。来源 PR 被丢弃时，草稿转为 `conflicted`。

用户故事：用户说"把这些数据做成一个页面"。Agent 开 PR、建表、写数据，然后用 `pr` 参数校验并保存草稿。
会话里出现草稿卡片，预览显示 PR 里的真实数据，卡片写明"来源表在 PR #3 中，合并后才能发布"。
用户在 PR 页面评审表，PR 页面也列出依赖它的页面草稿。合并后，用户在草稿页点发布，页面上线，此后只读 trunk。

改动分块，约 3 个 PR，按依赖叠成 stack：

1. **校验。** client-core 的 `readAndValidate` 接受 `worktreeId`，按上面的规则解析来源；CLI `html-view validate`
   加 `--worktree`，MCP `html_view_validate` 加 `pr`。纯客户端改动，不碰服务端。附录脚本的 A2、B2、B3 加上
   `--worktree` 后应分别返回 `B2 = 5`、`B2 = 42`、`Forecast!A1 = 99`。
2. **草稿记录来源 PR。** 草稿表加 `source_worktree_id`（产品库迁移，按 `apps/workspace/AGENTS.md` 跑完整迁移矩阵），
   `/api/html-view-drafts` 接受并返回它（HTTP contract，跑 `api:verify`）。服务端创建草稿时校验请求者能读这个 Worktree。
   发布前检查：Worktree 已合并才允许发布，已丢弃则拒绝并把草稿置为 `conflicted`。
3. **预览读 PR 数据。** `/drafts/{id}` 在草稿有来源 PR 时，绑定引擎改用 Worktree 的协同配置
   （复用编辑器里 `createWorktreeCollaborationConfig` 的那条路径），PR 里的 Unit 读 Worktree，其余读 trunk。
   预览保持只读（`workspace-binding-engine.ts:44` 已经对草稿关掉编辑），不会从页面写进 PR。html-view-creator Skill 改为"来源在 PR 里时带上 `pr`"。

S2 守住的不变量：

- 发布后的页面只读写 trunk，和今天一样。AGENTS.md 里"HTML View 绑定实时数据"的要求不变，预览读的是 PR 的实时数据，不是快照。
- 合并仍然只由人完成，Agent 不需要 `worktree:merge`。
- 页面不进 PR 评审，Blob 不进 Worktree。

S2 的风险：

- PR 在草稿保存后还会继续变。发布时只检查"已合并"，不在服务端重新校验绑定，因为校验在 client-core 里执行，
  服务端没有这段逻辑。合并后某个绑定的工作表被删掉，结果与今天删掉 trunk 来源一样，页面显示错误。
  如果你认为发布前必须重新校验，发布按钮可以在浏览器里先跑一次 trunk 校验，代价是 Browser 也要有校验代码。
- 草稿 7 天过期。PR 评审超过 7 天，草稿会先过期，需要 Agent 重新保存。
- 预览按 PR 读数据，看草稿的人必须能评审这个 PR。今天只有草稿作者能读草稿（`drafts.service.ts:49`），浏览器 Agent 以用户身份开 PR 和存草稿，作者能评审自己的 PR，所以这一条成立。实现时仍要在服务端检查，不依赖这个巧合。

## 6. 需要你决定的问题

1. **方向。** 是否认可"先 S1，再 S2"？还是你倾向直接做 S3（页面进 PR），或者只做 S1 就够？
2. **发布时机。** S2 里，来源 PR 未合并时是否完全禁止发布？我建议禁止，因为发布后的页面读 trunk，未合并就发布会让访客看到报错。
3. **合并与发布的关系。** 合并 PR 后，是否在 PR 页面直接提供"发布关联页面"？还是保持现在的规则，用户到草稿页单独点发布？
   前者少一步，后者和"草稿只有用户能发布"的现有规则完全一致。
4. **DSH 的合并授权。** DSH Skill 允许 Agent 在用户授权后合并。S2 上线后，DSH 是否也改为"带 PR 保存草稿、由人合并"，和浏览器 Agent 一致？

## 7. 验证计划

附录脚本就是验证工具，每一步改动后重跑：

- S1：A2 返回新的错误码和说明，其他步骤结果不变。
- S2 第 1 块：A2、B2、B3 加 `--worktree` 后通过，样本分别是 PR 里的 5、42、99；不加时结果与今天相同。
- S2 第 2、3 块：在 `verify-uvw` 里用 MCP 带 `pr` 保存草稿，打开 `/drafts/{id}` 截图，预览显示 PR 里的值；
  合并前发布被拒绝；合并后发布，页面在 `/nodes/{id}` 显示 trunk 值；丢弃另一个 PR 后，它关联的草稿变为 `conflicted`。
- 端到端：用 `verify-uvw story` 跑一句用户原话"把这些数据做成一个页面"，数据不在 Workspace 里，
  检查 Agent 没有调用失败的 trunk 校验，并给出带 PR 的草稿链接。

## 附录：复现脚本

脚本是一次性工具，没有提交。前提是已经按 `.claude/skills/verify-uvw/SKILL.md` 执行了 `up` 和 `user`。

```bash
export VERIFY_UVW_ROOT=/tmp/verify-uvw-r2 VERIFY_UVW_RUN=hvwt VERIFY_UVW_SERVER_PORT=3940 VERIFY_UVW_WEB_PORT=5990
V=.claude/skills/verify-uvw/bin/verify-uvw
eval "$($V env)"
O=verify-hvwt E=$EVIDENCE
j() { jq -r "$2" "$E/$1.out"; }

$V cli a-pr pr create -R $O/personal -t "HV worktree data" --json
W=$(j a-pr .id); P=$(j a-pr .number)
$V cli a-unit unit create --worktree $W --space $O/personal --type sheet --name "Sales" --json
U=$(j a-unit .unit.unitId); R=$(j a-unit .unit.resourceId)
$V cli a-seed execute --worktree $W --unit $U --json -e 'const ws=workbook.getActiveSheet(); ws.getRange("A1:B2").setValues([["Item","Qty"],["Rent",5]]); return {sheet:ws.getSheetId()};'
S=$(j a-seed .value.sheet)
printf '<!DOCTYPE html><html><head><title>Qty</title></head><body><p>Qty <output data-univer-cell-text="%s:%s:B2">loading</output></p></body></html>\n' $U $S > $E/a.univer.html
$V cli a-validate-before-merge html-view validate --file $E/a.univer.html --json   # 403 Cannot read this unit.
$V cli a-ready pr ready $P -R $O/personal --json
$V cli a-merge pr merge $P -R $O/personal --json
$V cli a-validate-after-merge html-view validate --file $E/a.univer.html --json    # valid, B2 = 5

$V cli b-pr pr create -R $O/personal -t "HV change" --json
W2=$(j b-pr .id)
$V cli b-add unit add --worktree $W2 --resource $R --json
$V cli b-edit execute --worktree $W2 --unit $U --json -e 'workbook.getActiveSheet().getRange("B2").setValue(42); const s2=workbook.insertSheet("Forecast"); s2.getRange("A1").setValue(99); return {sheet2:s2.getSheetId()};'
S2=$(j b-edit .value.sheet2)
$V cli b-validate-stale html-view validate --file $E/a.univer.html --json          # valid, but B2 = 5 (trunk)
printf '<!DOCTYPE html><html><head><title>Forecast</title></head><body><p>F <output data-univer-cell-text="%s:%s:A1">loading</output></p></body></html>\n' $U $S2 > $E/b.univer.html
$V cli b-validate-new-sheet html-view validate --file $E/b.univer.html --json      # Source worksheet not found
```
