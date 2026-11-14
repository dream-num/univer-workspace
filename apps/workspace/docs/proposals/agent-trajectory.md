# Workspace Agents trajectory 设计

Trajectory 是浏览器 Agents 会话页上的调试视图。它把一次会话还原成模型实际收到的请求序列：系统提示词、每条用户消息、每次模型调用的回复、每个工具结果，以及每次模型调用和工具执行的耗时。
它只在打开 Debug mode 后出现，普通用户看不到。
实施步骤见 [agent-trajectory-plan.md](./agent-trajectory-plan.md)。

## 唯一的展示规则是按发送形态展示

Trajectory 展示的每条消息都是它发给模型时的样子。这条规则决定了下面所有设计。

- 数据来源是 provider HTTP 请求体，不是 `UIMessage` parts。`UIMessage` 是界面形态，转换成请求时会合并、改写或丢弃内容，比如 system-reminder 合进用户消息、工具结果改成 `toModelOutput` 的文本、reasoning 是否回传取决于 provider。只看 `UIMessage` 会把转换层的问题藏起来。
- system-reminder 留在承载它的用户消息里，不拆成独立行。界面只在原文旁边标出来源（Skill catalog、References、Settings change、Draft states、Skill invocation），不改顺序，不改文字。
- 工具结果默认显示模型收到的 tool message。MCP 原始返回（`content` 加 `structuredContent`）放在单独的标签页，并注明它不是模型看到的内容。
- 助手消息有两个视图。Response 是模型这次调用返回的内容。Replayed as 是这条回复在下一次请求里回传给模型的样子。两者不一致本身就是调试线索。
- 没有记录的旧会话不做重建。重建出来的内容不是发送形态，会违反这条规则。

## 原型对比后选了 B

两个一次性原型都用同一份按真实形态构造的 mock 会话，放在本机 `/tmp/uvw-trajectory-prototype/`（`index.html`，按 1 和 2 切换，截图在 `shots/`）。
原型 A 仿照 DSH，用平铺时间线加三泳道 minimap。原型 B 参考 LangSmith、Langfuse 和 OpenAI Agents traces，用 Turn、模型调用、工具三层树，每行带按 Turn 缩放的瀑布条，模型调用详情里有 Context sent。
操作者在 2026-11-14 选择 B，并补充了按发送形态展示的规则。原型 B 把 system-reminder 画成独立的 CONTEXT 行，按新规则改为留在 USER 消息内并标注来源。

## 现有数据回答不了的三个问题

当前会话记录（`agent.types.ts` 的 `sessionRecordSchema`）缺三样东西。

1. 没有请求体。`modelSnapshot` 只保存首次的系统提示词和工具定义，之后每次请求实际发了什么没有留下。
2. 没有模型调用的耗时和单次用量。`cacheUsage` 只有累计值和最后一步。
3. 工具耗时偏长。`runner.ts` 的 `snapshot()` 在工具 part 第一次出现时记 `startedAt`，那时模型还在流式输出参数，所以工具耗时包含了参数生成时间。

## 记录模型请求

每次模型调用写一条 `ModelCallRecord`，存在独立的 IndexedDB 数据库里。

### 请求体从 provider fetch 捕获

`createModel`（`runtime/model.ts`）接收的 `request` 是 provider 请求的唯一出口。runner 把它换成记录器包装过的 fetch，记录器读取 `init.body` 字符串，也就是发到 provider 的原始字节。
选 fetch 包装而不用 SDK 的 `include: { requestBody: true }`，原因有两条。fetch 能看到失败的请求和 SDK 自动重试的每一次尝试，`onStepEnd` 只在步骤成功时给出请求体，而失败的调用正是最需要排查的。fetch 层也不依赖 SDK 的事件形状，SDK 升级时少一处耦合。

耗时、用量和调用边界来自 `ToolLoopAgent` 的事件。

| 事件 | 记录内容 |
|---|---|
| `onStepStart` | 上一个调用仍为 `running` 时先记为 `aborted`，再新建当前调用，记 `startedAt`，写入一条 `running` 记录 |
| `onLanguageModelCallStart` | 给当前调用加一次 attempt，记 attempt 的 `startedAt` |
| provider fetch | 把请求体和 HTTP 状态填进当前 attempt。第一次 attempt 的请求体作为记录的请求体。非 2xx 响应读取最多 64 KB 错误正文 |
| `onLanguageModelCallEnd` | 记 `endedAt`、`usage`、`performance`、`finishReason` 和 `content`（模型返回的 text、reasoning、tool-call） |
| `onStepError` | 当前调用记为 `error`，附错误信息 |
| `onAbort` | 当前调用记为 `aborted` |
| runner 的 `finally` | 仍为 `running` 的调用记为 `aborted` |
| `onToolExecutionStart`、`onToolExecutionEnd` | 写 `session.toolTimings[toolCallId]`，取代 `snapshot()` 里按 part 出现时间记的写法。回调里不发布会话，计时随下一次消息更新发布，避免每个工具多两次重渲染 |

调用边界用 `onStepStart`，不用事件里的 `callId`。`ai@7.0.166` 的 `callId` 在每次 `streamText` 调用时生成一次（`dist/index.js` 第 9798 行），同一次 run 的所有步骤共用它。SDK 的重试包在 `streamLanguageModelCall` 外面，每次重试都会再次触发 `onLanguageModelCallStart`，而 step start 在一个步骤内只通知一次。所以一个步骤是一条记录，步骤内每次 `onLanguageModelCallStart` 是一次 attempt。

`ai@7.0.166` 只在消费方继续读取流时触发 `onAbort`。引导消息在 provider 回复之前取消流时，这个步骤收不到任何结束事件。同一会话的调用是串行的，所以下一个 `onStepStart` 到来时，仍为 `running` 的上一个调用已经结束，记为 `aborted`。

同一会话的模型调用是串行的，所以记录器用一个「当前调用」变量把 fetch 归到调用上，不需要锁。

### 请求体按增量保存

完整请求体每次都包含全部历史，直接保存会按调用次数平方增长。记录器只保存与上一次请求的差异。

```ts
type RequestDelta =
  | { kind: "delta"; base: number; messages: unknown[]; rest?: Record<string, unknown> }
  | { kind: "raw"; body: string };
```

- 请求体解析为 JSON 后拆成 `messages` 和其余字段 `rest`（`model`、`tools`、`stream`、thinking 参数等）。
- `base` 是本次 `messages` 与上一次完整 `messages` 从头开始逐条相等（按 `JSON.stringify` 比较）的条数。`messages` 只存 `base` 之后的部分。
- `rest` 与上一次相同时省略。
- 展开时 `full[k].messages = full[k-1].messages.slice(0, base).concat(delta.messages)`，`rest` 缺省时沿用上一次。
- 编码后立即展开并与原始字符串比较。`JSON.stringify(expanded) !== body` 时改存 `{ kind: "raw", body }`。这保证展开结果与发送字节完全一致，不依赖「JSON 往返不改变字节」的假设。
- 上一次请求指同一会话中 `seq` 最大的记录，跨 run、跨 Turn 都成立，失败的调用也算，因为它的请求同样发出去了。run 开始时记录器从存储读出该会话已有记录并展开一次，之后在内存里保留上一次的完整请求。

`base` 小于上一次的消息条数说明历史被改写，前缀缓存在这一处失效。仓库规则要求历史只追加（`AGENTS.md` 的「Workspace Agents 提示缓存」），trajectory 把这种情况标为 history rewrite。`rest` 变化（例如用户在两轮之间切换模型）标为参数变化，属于预期情况，只提示不报错。

### 记录的类型

```ts
interface ModelCallRecord {
  sessionId: AgentSessionId;
  seq: number;
  runId: string;
  startedAt: string;
  endedAt: string | null;
  outcome:
    | { kind: "running" }
    | { kind: "ok"; finishReason: string }
    | { kind: "error"; message: string }
    | { kind: "aborted" };
  attempts: { startedAt: string; endedAt: string | null; status: number | null; errorBody?: string }[];
  request: RequestDelta;
  response: unknown[] | null;
  usage: { inputTokens: number; cacheReadTokens: number; outputTokens: number; reasoningTokens: number } | null;
  performance: { responseTimeMs: number; timeToFirstOutputMs: number | null } | null;
}
```

`runId` 是 SDK 的 `callId`，只用来区分同一会话的不同 run。`outcome` 用判别联合，不用多个布尔值。读取时用 zod schema 在存储边界解析，解析失败的记录跳过并计数，界面显示跳过条数。

### 存储

- 数据库名 `univer-workspace-agent-trajectory-<userId>`，版本 1，一个 object store `modelCalls`，keyPath 为 `["sessionId", "seq"]`。按会话读取用 `IDBKeyRange.bound([id, 0], [id, Infinity])`。
- 用独立数据库而不是给 `univer-workspace-agents-<userId>` 升版本。现有 `openAgentDatabase` 在 `onupgradeneeded` 里无条件建全部 store，`onblocked` 直接报错。升版本要改升级逻辑，还会让旧标签页挡住新标签页打开 Agents。独立数据库没有这两个问题。
- 打开数据库的锁和 Promise 逻辑从 `database.ts` 抽成 `openIndexedDatabase(factory, locks, name, stores)`，两个数据库共用。
- 写入时机是调用开始一次、结束一次。写入失败只记录到控制台，不让 run 失败。记录是调试数据，不能影响用户的会话。
- 写入前对请求体、响应和错误正文做与 `redactMessages` 相同的 API key 替换。key 在请求头里，正文本不该出现，替换是防用户把 key 粘贴进消息。
- 记录始终开启，与 Debug mode 无关。这样用户在关闭 Debug mode 时遇到的问题，打开后仍能查看。增量编码后存储量约等于会话本身的内容量。会话目前没有删除入口，记录也不加保留期限，与会话保持一致。

## 构建 trajectory

`buildTrajectory(records, session)` 是纯函数，输入展开后的请求序列和会话记录，输出界面需要的树。

```ts
interface Trajectory {
  system: { message: WireMessage; tools: unknown[]; params: Record<string, unknown> } | null;
  turns: Turn[];
  stats: { calls: number; toolCalls: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; errors: number; rewrites: number; skippedRecords: number };
  unrecorded: boolean;
}
interface Turn { index: number; startedAt: number; endedAt: number; steps: Step[] }
type Step =
  | { kind: "user"; step: number; message: WireMessage; reminders: ReminderSpan[]; sentAt: number; firstSeq: number }
  | { kind: "assistant"; step: number; seq: number; call: CallView; response: unknown[] | null; replay: WireMessage | null; replayMismatch: boolean; request: ExpandedRequest; newFrom: number; rewrite: boolean; paramsChanged: boolean }
  | { kind: "tool"; step: number; parentStep: number; toolCallId: string; name: string; arguments: unknown; message: WireMessage | null; mcpOutput: unknown; status: "ok" | "error" | "denied" | "running" | "unsent"; startedAt: number | null; endedAt: number | null };
```

`WireMessage` 是 OpenAI chat 格式的一条消息（`role` 为 `system`、`user`、`assistant` 或 `tool`）。两个 provider（`@ai-sdk/deepseek` 和 `@ai-sdk/openai-compatible`）都发这种格式。解析用宽松的 zod schema（`passthrough`），解析失败的请求在界面上只显示原始请求体。

构建算法如下。

1. 展开全部记录，得到每次调用的完整请求。第一次请求的 `messages[0]`（`role: "system"`）和 `rest.tools` 构成 `system`。
2. 按 `seq` 顺序遍历每次调用新增的消息（下标 `base` 之后的部分），维护「当前 Turn」和「待配对的工具调用」。
3. 遇到 `user` 消息就开始新 Turn，生成 user step，`sentAt` 取首次包含它的调用的 `startedAt`。这条规则同时覆盖首条消息和运行中追加的引导消息。
4. 遇到 `assistant` 消息就把它作为上一次调用的 `replay`，并与该调用的 `response` 比较文本和工具调用 id，不一致时设置 `replayMismatch`。
5. 遇到 `tool` 消息就按 `tool_call_id` 填到对应的 tool step。
6. 每次调用本身生成一个 assistant step，它的 `response` 里每个工具调用生成一个 tool step，`parentStep` 指向它。最后一次调用没有下一次请求，tool step 的 `message` 为 `null`，状态为 `unsent`。失败或中断的调用没有子行，但如果下一次请求回放了它的工具调用（例如中断后补上的工具结果），按回放生成 tool step，模型收到的工具消息不会从树里消失。
7. 工具耗时取 `session.toolTimings`。工具的错误状态和 `mcpOutput` 按 `toolCallId` 从 `session.messages` 的 tool part 取。
8. step 编号在 Turn 内从 1 开始，按上面生成顺序递增。
9. 会话有消息但没有任何记录时，`unrecorded` 为 `true`。

`ReminderSpan` 标出用户消息原文里每个 `<system-reminder>` 块的起止位置和来源。来源按文本特征识别，规则集中在一张表里。

| 来源 | 识别依据 | 写入位置 |
|---|---|---|
| Skill catalog | `Skills available in this session` | `runtime/skills.ts` 的 `skillsReminder` |
| Skill invocation | `The user invoked` | `runtime/skills.ts` 的 `skillInvocation` |
| References | `The user attached these references` | `runtime/runner.ts` 的 `referencesReminder` |
| Settings change | `The user changed the session settings` | `runtime/runner.ts` 的 `settingsReminder` |
| Draft states | 以 `Draft "` 开头且带状态的行 | `runtime/draft-reminder.ts` 的 `draftReminder` |
| Reminder | 以上都不匹配 | 其他 |

## 界面

### Debug mode 开关

- `shared/debug-mode.ts` 导出 `useDebugMode(): [boolean, (on: boolean) => void]`，用 `useSyncExternalStore` 读 `localStorage` 的 `univer-workspace-debug-mode`，监听 `storage` 事件同步其他标签页。读写失败时视为关闭，写法与 `shared/theme.tsx` 一致。
- `features/account/app-settings-dialog.tsx` 在主题下面加一行「调试模式」，用现有的 `Segmented` 组件（关、开），下方一行说明「在 Agent 会话页显示 Trajectory，查看发给模型的完整请求、工具结果和耗时。仅保存在本浏览器。」
- 关闭时会话页与现在完全一样。

### 会话页

打开 Debug mode 后，会话页顶部出现「对话」和「Trajectory」两个标签。标签状态是组件内状态，不进 URL。Trajectory 标签占满会话页宽度，替换对话列和右侧栏，不显示输入框。切换标签时对话面板保持挂载，输入框里的草稿不丢。打开 Debug mode 后就预先加载 Trajectory 视图模块，点击标签时不经过 Suspense；关闭时不加载。

工具栏依次显示 Turn 数、模型调用数、工具调用数、输入和输出 token、缓存命中率、错误数、history rewrite 次数，然后是「只看错误」、「全部展开或折叠」和搜索框。搜索覆盖全部发送内容和 MCP 原始结果。

树有四列，依次是 Span、Waterfall（按 Turn 缩放）、Duration、Tokens in / out。

- 第一行是 SYSTEM，点开看系统提示词和工具定义。
- 每个 Turn 一行，带整段 Turn 的瀑布条和总耗时，可折叠。
- Turn 下依次是 USER、ASSISTANT 和工具行。ASSISTANT 行标题取回复文本或 reasoning 的第一行，没有文本时显示工具调用数。瀑布条标出首个输出 token 的时间点。
- 工具行缩进在发起它的 ASSISTANT 下，显示工具名和发送内容的第一行。
- 失败、中断和 history rewrite 的行用红色标出，并在行尾写原因。
- 运行中的会话每秒刷新一次，正在进行的调用显示持续增长的瀑布条。运行中的 Turn 按已用时间向上取整到 10 秒缩放，已结束的 Turn 按实际时长缩放。
- `unrecorded` 为真时，树的位置显示「此会话创建于 trajectory 记录上线之前，没有模型请求记录。」

### 详情面板

点击一行在右侧打开详情面板，标题显示类型、`Turn n · Step m` 和耗时。

| 行 | 标签页 |
|---|---|
| SYSTEM | System prompt（原文）、Tools（每个工具按发送形态的 JSON）、Request params（`rest` 去掉 `messages` 和 `tools`） |
| USER | As sent（原文，system-reminder 块在左侧标出来源）、Raw |
| ASSISTANT | Response、Context sent、Replayed as、Usage & timing、Raw |
| TOOL | As sent（模型收到的 tool message）、Arguments、MCP result、Timing、Schema |

- Context sent 显示本次调用的完整请求。上方是缓存命中条（输入 token、命中 token、未命中 token）。下方按发送顺序列出每条消息的角色、首行和大小，本次新增的标 NEW，被改写的位置标 REWRITTEN。按钮「复制请求 JSON」复制的就是发送时的原始请求体，可以直接拿去重放。
- Usage & timing 列出开始时间、首个输出 token 时间、总耗时、各类 token、每次 attempt 的 HTTP 状态和错误正文。
- MCP result 标签页顶部写明「这是 MCP 网关的原始返回，不是模型收到的内容」。

### JSON 和长文本

- JSON 用可折叠的树显示，可以切到 Raw 文本，可以复制。
- 大于 4 KB 或深度达到 3 层的节点默认折叠，摘要显示键数或条数和大小。
- 超过 240 字符的字符串先截断，点击展开全文。
- 内容本身是 JSON 的字符串（tool message 的 `content` 常是这样）就地解析成树，并标注「JSON string」，Raw 视图仍显示原字符串。
- 超过 30 行的文本块默认折叠，显示行数和大小，点击展开。
- 展开后显示全部内容，不截断。

## 不做的事

- 不重建旧会话的 trajectory。
- 标签状态不进 URL，不做单步永久链接。
- 不导出或上传 trajectory。复制请求 JSON 已经覆盖重放需要。
- 不展示子 agent，浏览器 Agents 没有子 agent。
