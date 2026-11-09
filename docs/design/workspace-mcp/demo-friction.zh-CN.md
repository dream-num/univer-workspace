# 演示中的摩擦记录（2026-11-09）

> 阶段 A 到 F 完成后，用真实客户端完整走一遍 Workspace MCP，记录使用中的摩擦，作为后续改进的素材。
> 这里只记录现象、证据和改进方向，不是已经接受的设计决定。

## 演示环境

- `verify-uvw` run `demo`，启动 HEAD `26c1b69d`。Workspace、MCP 网关、executor、renderer 都是真实服务，没有 mock。
- 客户端是 opencode v2.0.26，模型是 `console-deepseek/deepseek-flash#high`，PAT 认证。连接 URL 先用 `?toolsets=core,admin`，场景 7 改为 `?toolsets=all`。
- 一个连续会话，7 轮中文自然语言请求，之后人在浏览器里审阅并合入。

| 场景 | 请求 | 结果 | 耗时 | 工具调用 | 模型费用 |
| --- | --- | --- | --- | --- | --- |
| 1 | 我是谁，能访问哪些空间 | 成功 | 9 s | 2 | $0.0024 |
| 2 | 新建团队空间「市场部」并开 Issue | 成功 | 12 s | 3 | $0.0016 |
| 3 | 开 PR，新建表格，写数据和公式，读回核对 | 成功 | 66 s | 16 | $0.0067 |
| 4 | 表头格式、冻结首行、柱状图，截图描述 | 成功 | 67 s | 18 | $0.0057 |
| 5 | 人合入后关闭 Issue，导出 xlsx | 成功 | 78 s | 15 | $0.0053 |
| 6 | 写一页 Doc 简报，导出 PDF | Doc 成功，PDF 失败 | 180 s | 18 | $0.0113 |
| 7 | 切到 `toolsets=all` 后重试 PDF | 成功，1 页 | 42 s | 2 | $0.0016 |

7 个场景合计 76 次工具调用，约 7.5 分钟，模型费用约 $0.035。导出的 xlsx 含公式、冻结窗格和图表；PDF 用 `pdfinfo` 打开为 1 页。

## 摩擦清单

严重度按用户能否完成任务来分。“高”表示任务失败，“中”表示多花调用或绕路，“低”表示体验瑕疵。

### P1（高）默认连接做不出 PDF，模型也不知道还有别的工具集（#257）

- **现象。** 场景 6 要求导出 PDF。`print_pdf` 和 `compile_markdown` 属于 `files` 工具集，`core,admin` 连接里没有。模型试了 `export(format: "pdf")`，被参数校验拒绝，最后建议用户去跑 `uvw print-pdf`，而用户未必装了 CLI。改成 `?toolsets=all` 后，同一请求 2 次调用完成。
- **原因（已核对）。** server instructions 只提到 `?toolsets=admin`，没有提 `files`。instructions 要求模型在“skill 提到的命令没有对应工具时告诉用户”，模型照做了，但它给不出正确的解决办法。
- **方向。** instructions 列出当前连接没有加载的工具集及其中的工具名，并说明加哪个 `toolsets` 参数。也可以考虑把 `print_pdf` 放进 `core`，或者在 `export` 的格式错误里提示 `print_pdf`。

### P2（中）`export` 不能导出正式版（#258）

- **现象。** 场景 5 要导出合入后的正式版。`export` 必须带 `worktree`，没有 trunk 选项，而 `inspect` 和 `screenshot` 都支持 `trunk: true`。模型只好从已合入的 PR 的 Worktree 导出，再额外调用 3 次 `inspect` 和 `screenshot`，确认 trunk 和 Worktree 一致。
- **影响（推断）。** 想导出一个不在任何 PR 里的现有文件时，用户必须先开 PR、`unit_add`，才能导出。
- **方向。** 给 `export` 加 trunk 范围，与 `inspect`、`screenshot` 保持一致。如果这是有意的限制，在工具描述里写明原因和替代步骤。

### P3（中）通过 MCP 提供的 skills 是 CLI 版本，读起来费劲（#259）

- **现象。** 场景 3 中，模型用了 7 次调用才读到需要的 skill 内容。它先猜错 `skills_read` 的返回结构（实际是 `{ skills: [{ name, content }] }`），然后因为 `core` skill 有约 22 KB，只能分段切片读取。skill 正文写的是 `uvw` 命令和 `--worktree` 这类 CLI 参数，模型要按 instructions 自行换算成工具名。
- **方向。** 给 MCP 渲染一份工具名版本的 skill，或者在 `skills_read` 的结果里直接给出命令到工具的映射。把 `core` 拆小，或者按需返回章节。

### P4（中）合入记录显示“未知用户”（#260）

- **现象。** 在浏览器里由 Verify demo 合入 PR #2 后，空间首页“最近活动”和文件列表显示“未知用户 合入了 Pull request #2”。
- **原因（已核对）。** `apps/workspace/server/src/modules/activity/activity.service.ts:118` 对所有 `pull-merged` 事件写死 `actor: null`。这是 Workspace 产品问题，与 MCP 无关，但每次 Agent 加人工评审的演示都会碰到。
- **方向。** 记录并返回合入人。

### P5（中）ready 和 draft 之间来回切换（#261）

- **现象。** server instructions 第 5 步要求每个任务结束时 `pr_ready`。用户在同一个 PR 上追加修改时，`execute` 只能用于 draft（`packages/client-core/src/runtime-source.ts:47`），所以模型先 `pr_ready(undo: true)`，改完再 `pr_ready`。场景 4 出现了这个往返。场景 3 中，用户没有要求 ready，模型也按 instructions 标记了 ready，这才使场景 4 需要先 undo。
- **方向。** 二选一：允许在 ready 的 PR 上继续写入并自动回到 draft，或者在 `execute` 的描述里写明“ready 状态要先 undo”。也可以让 instructions 只在用户表示完成时才 ready。这一项需要产品负责人决定。

### P6（低）`execute` 的脚本错误没有位置

- **现象。** 场景 4 中，一次 `execute` 只返回 `Cannot read properties of undefined (reading '0')`，没有行号，模型只能查 API 后整段重写。
- **方向。** 返回出错的行号和列号，或者脚本内的调用栈。

### P7（低）`api_find` 只做字面匹配

- **现象。** 场景 4 中，`api_find({ terms: ["freeze rows"] })` 没有结果，换成 `setFrozenRows` 才命中。模型第一次还把参数名猜成 `queries`。校验错误写得很清楚，模型下一次就改对了。
- **方向。** 支持按 summary 文本或分词匹配，或者在零结果时返回相近的符号。

### P8（低）输入和输出的字段名不一致（#262）

- **现象。** `pr_create` 接收 `title` 和 `body`，`pr_view` 返回 `name` 和 `summary`。场景 3 中，模型专门调用一次 `pr_view` 去看有哪些 key。
- **方向。** 输出补上与输入同名的字段，或者在 outputSchema 的描述里写明对应关系。

### P9（低）错误信息里出现 CLI 参数写法（#263）

- **现象。** 场景 5 中，`inspect` 返回 `--worksheet is only valid for range, not worksheet`。MCP 的参数名是 `worksheet`，不是 `--worksheet`。
- **方向。** 网关把 client-core 的错误文案换成 MCP 参数名。工具规格 1.3 节已经要求错误映射，这一条属于遗漏。

### P10（低）`print_pdf` 的文件名是 unit ID（#264）

- **现象。** 场景 7 的 PDF 名为 `27e0774e-e424-4ec3-a73a-6e225022f196.pdf`，而 `export` 的 xlsx 用文档名 `Q3 区域销售.xlsx`。
- **方向。** `print_pdf` 和 `export` 使用同一套命名规则。

### P11（低）Doc 截图带有编辑器的折叠箭头

- **现象。** 场景 6 中，Doc 截图里每个标题前有折叠箭头（▾），这是编辑器的界面元素。同一文档的 `print_pdf` 结果没有箭头。
- **方向。** 截图时隐藏标题折叠控件。需要先判断归属在本仓库的渲染装配还是上游 Univer SDK。

### P12（低）PR 和 Issue 之间没有结构化关联（#265）

- **现象。** 模型在 PR 描述里写了“关联 Issue #1”，但网页上它只是普通文字，不能点击。Issue 页显示“没有关联文件”。PR 合入后，Issue 仍然打开，场景 5 由模型手动关闭。
- **方向。** 支持 `#1` 自动链接，以及 PR 关闭 Issue 的约定（例如 `Closes #1`）。

### P13（低）新建文件的“对比”视图首次加载超过 5 秒

- **现象。** PR 文档变更页点“对比”后，5 秒时仍是加载动画。15 秒时已显示结构化对比（Doc 共 89 处差异），所以不是卡死，只是慢。没有测量具体耗时。

## 客户端与模型侧的现象

这些不是 Workspace MCP 的缺陷，但会影响用户体验，记录供参考。

- **模型编造本地图片路径。** 场景 4 和场景 6 中，模型确实收到了截图（opencode 把 MCP `image` 内容块转成 `file` 片段），但它在回答里写了 `![...](/tmp/.../shot.png)`，而这个文件不存在。可以考虑让 `screenshot` 对小图也附带一个短时效下载链接，让模型有真实的地址可以引用。
- **工具名重名。** opencode v2 的代码模式把所有 MCP 调用包在它自己的 `execute` 工具里，Workspace 也有一个 `execute` 工具，会话记录里两者混在一起。
- **模型写的 JS 有低级错误。** 一次字符串没有闭合，一次忘了 `return`，导致结果为 `null`。模型都在下一次调用中自行修正。
- **下载链接进入对话记录。** 链接带 15 分钟有效的 token。会话一旦被分享，链接在有效期内可以使用。
- **`opencode mcp list` 显示 “No MCP servers configured”。** 实际上项目目录下的 `opencode.json` 已生效，工具都能调用。用户排查连接问题时会被误导。
- **工具定义体积。** `toolsets=all` 时 54 个工具定义共约 125 KB，`core` 时 31 个约 76 KB。opencode 的代码模式按需检索工具，所以单步上下文约 15k token。对一次性加载全部工具定义的客户端，这个体积值得在阶段 H 的客户端实测里关注。

## 做得好的地方

- 除场景 6 所需工具不在当前工具集外，模型都选对了主要工具。6 次执行出错，模型都根据错误信息改正或换了做法。
- `screenshot` 把图片直接交给模型，模型对表格数值、图表标题和柱子高低的描述与图片一致。
- headless 写入的公式、格式、冻结窗格和图表，在浏览器 PR 视图、正式版、导出的 xlsx 里都一致。
- 浏览器里的 Doc“对比”视图标明“AI 修改版本 · 修订 3”，并列出逐段差异，人工评审容易看懂。
- 改 `toolsets` 后不需要重启 opencode，下一轮请求就拿到了新工具。
