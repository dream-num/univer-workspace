# 低门槛 Agent 入口调研

> 状态：调研结论与建议，未实现。调研日期 2026-11-07。
> 后续：第 9 节的问题已有决定，工程需求见 [Univer Workspace 远程 MCP Server](workspace-mcp/README.zh-CN.md)，其中的工具集取代本文 5.2 节。
> 业界信息来自公开文档与第三方文章，标注“未核实”的条目只有单一来源或来源互相矛盾，决策前需要复核。

## 一句话结论

让非开发者用自己的主力 agent（ChatGPT、Claude、WorkBuddy 等）操作 Workspace，最可行的路线是
**由 Workspace 部署自带一个远程 MCP 端点**：用户在 agent 里粘贴一个 URL、在浏览器里登录一次，此后不装任何东西。

这条路线不需要我们提供“云端通用 agent”。大模型推理仍由用户自己的 ChatGPT 或 Claude 承担，我们只承担工具执行，
也就是今天 CLI 在用户本机跑的那套 headless Univer 运行时。它的成本是 CPU 和内存，不是 token。
本机 MCP 会原样继承 CLI 的分发难题，因为难题出在运行时（Node 加约 80 MB 的原生绑定），不在协议。

## 目录

1. 问题与现状
2. 两个需要先纠正的前提
3. 业界做法
4. 方案空间与对比
5. 推荐架构：Workspace 自带远程 MCP
6. 本机路线的正确做法
7. 更巧妙的入口
8. 分阶段路线
9. 需要你拍板的问题
10. 参考资料

## 1. 问题与现状

### 1.1 两个现有入口各自卡在哪里

| 入口 | 用户要做的事 | 摩擦 |
| --- | --- | --- |
| Workspace Agent（`apps/agent`，基于 DSH） | 下载实验性 Electron 桌面包，或从源码启动本地网页；另配模型凭据；登录 Workspace | 独立入口，不是用户的主力 agent；模型凭据与 Workspace 登录是两件事；桌面包只通过 GitHub Releases 分发（`apps/agent/README.md`） |
| `univer-workspace-cli`（`uvw`） | 装 Node ≥ 22.12，`npm i -g`，再让 agent 通过 shell 和 Skill 使用 | Node、npm、原生绑定、终端，全部是开发者工具链；只在能跑 shell 的 agent 里可用（Claude Code、Codex、Cursor 等） |

两者的共同点是：用户必须先在本机准备一套运行时，才能让 agent 碰到文档。
非开发者最常用的 agent（ChatGPT 网页与 App、claude.ai、手机端）根本没有本机 shell，这两条路对它们完全关闭。

### 1.2 CLI 在用户本机到底跑了什么

搞清楚这一点，才能判断“把它搬到哪里”。以下事实来自本仓库代码。

- **产品层命令是纯 HTTP。** `auth`、`repo`、`issue`、`label`、`pr`/`worktree`、`search`、`browse` 只加载
  `client-core` 的轻量 product 入口（`apps/cli/src/main.ts`、`apps/cli/src/product-commands.ts`）。
- **编辑文档发生在客户端。** `uvw execute` 把 agent 写的 Facade JS 交给本地 daemon。daemon 用 worker pool
  启动 headless Univer，以协同客户端身份接入 `/universer-api/worktrees/<id>`，执行脚本、收集 mutation、
  提交 changeset，冲突时最多重试 3 次（`packages/client-core/src/content-runtime.ts`、`content-worker.ts`）。
  服务端没有“按指令修改单元格”的 HTTP 接口；`POST /api/worktrees/{id}/units/{unitId}/changesets`
  要求调用方自己产出合法的 Univer mutation。
- **写入只能进 Worktree。** `execute` 拒绝直接写 trunk，读可以读 trunk。Worktree 就是 PR，合并和丢弃留给人。
- **运行时很重。** 三个 NAPI 原生绑定按平台分包：`doc-typst-native-binding` 约 37 MB、`exchange-node-binding`
  约 33 MB、`engine-formula-rust-binding` 约 9 MB，只覆盖 darwin-arm64/x64、linux-x64/arm64-gnu、win32-x64。
  打包产物 `package-dist` 约 68 MB。截图、PDF、版式 lint 还要按需下载 Chromium。
- **服务端其实已经在跑 headless Univer。** `unit-store.ts` 用 `UnitSnapshotMaterializer` worker pool 物化快照，
  `exchange.service.ts` 用 `exchange-node` 做 Office 导入导出，`unit-comparison.ts` 做比较。
  也就是说，“在服务器上跑 Univer”不是新能力，只是还没对 agent 开放“执行脚本并提交”这件事。

### 1.3 认证现状

Workspace 已有 OAuth 授权码加 PKCE 的签发能力（`apps/workspace/server/src/modules/identity/oauth-authorization-router.ts`），
`apps/agent` 正是用它登录。但它离 MCP 授权规范还有距离：

- 客户端是 `OAUTH_CLIENTS_JSON` 里的静态配置，回调地址精确匹配，没有动态注册。
- 只支持 `authorization_code`，没有 refresh token。拿到的 `access_token` 其实是 7 天有效的登录 session，
  必须以 `workspace_session` cookie 的形式发送，产品与协同接口都不认 `Authorization: Bearer`。
- 没有 `/.well-known/oauth-protected-resource`（RFC 9728）和 `/.well-known/oauth-authorization-server`（RFC 8414）。
- scope 只有 `identity` 和 `session`，后者等于用户全部权限，没有读写之分。

CLI 用的是另一条类似设备码的流程（`/api/auth/cli/authorizations`），同样换回一个 cookie session。

## 2. 两个需要先纠正的前提

### 2.1 “URL 形式的 MCP 意味着我们要提供云端 agent 算力”

不成立。远程 MCP 有两种完全不同的形态，成本差一个数量级：

| 形态 | 谁跑大模型 | 我们付什么 | 例子 |
| --- | --- | --- | --- |
| 工具型 MCP | 用户自己的 ChatGPT、Claude | 工具执行的 CPU、内存和带宽 | Notion、Linear、Figma、Canva、Airtable 的远程 MCP |
| agent 型 MCP（agent-as-a-tool） | 我们 | 每次调用的 token | Glean 把内部 agent 暴露成工具；Microsoft Work IQ 的 `ask` 工具 |

工具型才是业界主流，它把推理成本留在用户已经付费的 agent 里。我们要托管的是“headless Univer 执行器”，
不是“云端 agent”。这个执行器今天在用户本机由 CLI daemon 承担，搬到服务器后的单次成本大约是一次脚本执行加一次
changeset 提交，可以用配额管住（trial 部署已经有“每月三个编辑连接、十次导出”的配额，见 `apps/workspace/README.md`）。

agent 型 MCP 有它的位置（见 7.5 节），但不应该是第一步。

### 2.2 “本机 MCP 可以绕开云服务成本”

能绕开成本，但绕不开分发，而且会丢掉最重要的一批用户：

- **分发难题原样存在。** 本机 MCP 要么是 `npx`/`uvx` 启动（依赖 Node 或 Python，和 CLI 一样），要么要打包原生绑定和 Chromium。
- **ChatGPT 只接远程 HTTPS MCP。** claude.ai 网页、手机端也只接远程连接器。本机 MCP 只对桌面客户端有效。
- **业界正在离开本机 MCP。** Notion 公开说本地 MCP“技术门槛太高”，正在把重心转向托管版并可能停止维护本地仓库；
  GitHub 的 MCP 服务已不再发布 npm 包，主推托管端点；Figma 的桌面 MCP 只读、要付费席位，官方推荐远程版。

结论是：本机路线只适合作为“内网、离线、开发者”场景的补充，不能作为降低门槛的主路线。

## 3. 业界做法

### 3.1 同类产品怎么开放 agent 入口

| 产品 | 形态 | 认证 | 写入 | 值得借鉴的点 |
| --- | --- | --- | --- | --- |
| Notion | 远程为主，本地软弃用 | OAuth，继承用户权限 | 支持 | 放弃 API 一比一映射，改成面向 agent 的工具；用 Markdown 代替块 JSON 省 token |
| Figma | 远程加桌面 | OAuth | 支持（Full 席位） | `use_figma` 让模型写 JS 在 Figma 运行时里执行，就是 code mode；写入按席位门控，未来按量计费 |
| Linear | 远程 | OAuth 2.1 加 DCR，或 API key | 支持 | 另有 `/mcp/readonly` 只读端点 |
| Atlassian Rovo | 远程，仅 Cloud | OAuth 2.1 或 API token | 支持 | 管理员分别开关读、写、搜索；删除类工具默认关闭 |
| Google Workspace | 远程，开发者预览 | OAuth，自建 Cloud 项目 | 支持 | Sheets 只有 6 个工具；Docs 有 SUGGEST 写入模式，agent 的修改变成待接受的建议 |
| Microsoft 365 | Office 内置 Agent Mode，加 Work IQ 远程 MCP | Entra ID | 支持 | 把第三方 MCP 接进 Office，自己的数据也以 MCP 暴露 |
| 飞书 | 远程（推荐）加本地 | 应用或用户身份 | 部分 | 远程 MCP 先只开放文档场景；本地版 README 说云文档不能直接编辑 |
| 腾讯文档 | 官方 MCP，token | QQ/微信登录取 token | 支持 | 工具很高层：`create_excel_by_markdown` 等“从 Markdown 生成” |
| 钉钉 | MCP 广场托管 | URL 内嵌 key | 支持 | 企业管理员发放带 key 的 URL |
| WPS | 企业版需申请；个人版取 token | OAuth 或 Bearer | 支持 | 未核实 |

规律很明显：主流厂商都收敛到“托管远程 MCP、OAuth 继承用户权限、在 Claude 和 ChatGPT 里一键添加”。
国内厂商多用静态 token 或 URL 内嵌 key，因为国内客户端大多还没有 OAuth 流程（见 3.2）。

### 3.2 客户端支持矩阵（远程 MCP）

| 客户端 | 按 URL 添加 | OAuth | 写工具 | 请求从哪里发出 |
| --- | --- | --- | --- | --- |
| Claude（网页、桌面、Cowork、手机） | 是，Free 限一个，Pro 起不限；Team/Enterprise 需管理员先加 | DCR 或 CIMD；回调 `https://claude.ai/api/mcp/auth_callback` | 是，可设“始终允许” | Anthropic 云，IP `160.79.104.0/21`、`153.61.208.0/20` |
| ChatGPT | 是，需 HTTPS 且路径含 `/mcp` | OAuth 2.1 | 帮助中心称完整写入限 Business、Enterprise/Edu，Pro 只读（未核实，旧资料说法不同） | OpenAI 云；提供 Secure MCP Tunnel 接私网 |
| Microsoft Copilot | 经 Copilot Studio 或插件清单，需管理员或制作者 | DCR 或静态注册 | 是 | 微软云 |
| Gemini | App 端自定义连接器说法不一（未核实）；Enterprise 由管理员配置 | 是 | 是 | Google 云 |
| Cursor、VS Code | 是，另有一键安装链接 | 是 | 是 | 用户本机，可直连内网 |
| WorkBuddy、CodeBuddy | `mcp.json` 填 URL 与 Bearer 头 | 未找到 OAuth 流程 | 是 | 桌面与 CLI 客户端，推测为本机（未核实） |
| Kimi、Coze/豆包、通义 QwenWork、Trae | 粘贴 URL 或 JSON，带请求头 | 未找到消费端 OAuth | 是 | 视产品而定 |

两点直接影响方案：

1. **云端客户端够不到内网。** Claude 和 ChatGPT 都从自家云发起连接，私有化部署必须有公网 HTTPS 入口，并放行厂商 IP；
   OpenAI 有 `tunnel-client` 打通私网，Anthropic 的 MCP tunnels 目前只给 API 和 Managed Agents，claude.ai 用不了。
2. **国内客户端要 token 模式。** 只做 OAuth 会把 WorkBuddy 等挡在门外，需要同时提供个人访问令牌（PAT）。

### 3.3 协议本身的进展

- **授权。** 2025-11-25 版要求服务端实现 RFC 9728，推荐 Client ID Metadata Documents（CIMD），DCR 降为可选；
  客户端必须带 RFC 8707 `resource` 参数，服务端必须校验 token 受众。2026-07-28 版正式弃用 DCR，转向 CIMD。
- **无状态。** 2026-07-28 版去掉了 initialize 握手和 `Mcp-Session-Id`，Streamable HTTP 请求带 `Mcp-Method`、`Mcp-Name` 头。
  这对横向扩展是好消息。客户端还大多停在 2025-11-25，实现时两版都要兼容。
- **MCP Apps。** 工具可以声明一个 `ui://` 资源，宿主在沙箱 iframe 里渲染，通过 `postMessage` 通信。
  Claude、ChatGPT、Microsoft 365 Copilot、VS Code、Cursor 都已支持，ChatGPT 有全屏模式专门给编辑器类界面。
- **长任务。** Tasks 扩展（轮询式）适合导出、批量导入这类耗时操作。

### 3.4 工具怎么设计才不浪费上下文

- Anthropic 的工具设计建议：合并成少量高层工具，返回可选简略或详细格式，分页并给出可操作的错误信息。
- **code mode。** Cloudflare 把 2500 多个接口压成 `search` 和 `execute` 两个工具；Anthropic 的“code execution with MCP”
  在一个例子里把 15 万 token 降到 2 千。也有作者实测在工具很少时反而多花 17% 到 35% token（单一来源，未核实）。
  省 token 的前提是工具多或中间数据大，表格恰好是“中间数据大”的典型。
- 表格类 MCP 的共同做法：先给便宜的概览和采样工具，读取有单元格上限并分页，截断时明确告知，写入宁可拒绝也不部分写入。

我们的处境很特别：CLI 和 DSH 插件早已是 code mode。agent 写 Facade JS，`uvw execute` 或 `univer_edit` 执行，
`uvw api` 提供 API 参考。这套设计可以几乎原样搬进 MCP。

## 4. 方案空间与对比

| 方案 | 用户要做的事 | 覆盖的 agent | 我们的成本 | 内网可用 | 判断 |
| --- | --- | --- | --- | --- | --- |
| A. 远程 MCP，工具型，Workspace 部署自带 | 粘贴 URL，浏览器登录 | Claude 全端、ChatGPT、Copilot、Cursor、VS Code、WorkBuddy（PAT） | 服务端执行器的 CPU 与内存 | 本机客户端可以；云端客户端需公网入口 | **主路线** |
| B. 远程 MCP，agent 型 | 同上 | 同上 | token 成本，且多一层 agent | 同上 | 后期作为补充工具 |
| C. 本机 MCP，`npx` 启动 | 装 Node，改配置文件 | 仅桌面客户端 | 无 | 是 | 不解决问题，否决 |
| D. 本机 MCP，单文件二进制或 `.mcpb` | 下载并双击 | Claude Desktop（`.mcpb`）、其他桌面客户端（二进制） | 多平台构建与签名 | 是 | 作为内网、离线补充 |
| E. Skill 加 CLI，跑在 agent 自己的云沙箱里 | 上传 Skill，管理员放行出网域名 | claude.ai、Codex 等支持 Skill 和代码执行的 agent | 无 | 否 | 依赖出网白名单，不可靠 |
| F. 浏览器 agent 操作 Workspace 网页 | 装浏览器扩展 | Claude in Chrome 等 | 无 | 是 | 慢且脆弱，仅作兜底 |
| G. WebMCP，网页自己暴露工具 | 打开 Workspace 网页 | 目前只有 Gemini in Chrome，且在 origin trial | 无 | 是 | 押注未来，现在不投入 |

A 是唯一同时满足“零安装”和“进入用户主力 agent”的方案。其他方案要么仍需安装（C、D、F），
要么依赖用户或管理员改设置（E），要么生态还没到（G）。

## 5. 推荐架构：Workspace 自带远程 MCP

### 5.1 形态

```text
用户的 agent（ChatGPT / Claude / Cursor / WorkBuddy）
        │  Streamable HTTP + Bearer token
        ▼
https://<workspace>/mcp            ← Workspace 部署内的 MCP 应用（新）
        │  以用户身份调用，和 CLI 走同一套产品 API 与协同协议
        ├─ 产品 API：Space、Node、Issue、Worktree、Blob
        └─ 执行器 worker pool：headless Univer + 协同客户端
                 │ 提交 changeset 到 Worktree
                 ▼
Workspace Server（权威的身份、ACL、协同与存储）
```

关键判断是 **MCP 应用是第三个 Node-hosted Workspace Client，而不是 Server 的一部分**。
`packages/client-core` 按设计就是“Node-hosted Workspace Agent Client 共享的 HTTP、认证协议、远程 workflow 与 worker-backed content runtime”，
由宿主注入 origin、凭据、license 和 worker 入口，不读 CLI Session（见根 `AGENTS.md`）。CLI 是一个宿主，DSH 插件是另一个，
MCP 应用是第三个。这样做的好处：

- 符合仓库边界。Server 继续只做权威校验，不必新增“替客户端执行脚本”的职责；MCP 应用和 CLI 一样，只是一个用用户凭据调用 API 的客户端。
- 复用最大化。`executeAndCommit`、Office 交换、Markdown、Typst 都在 `client-core` 里，CLI 与 MCP 行为天然一致。
- 部署跟着 Workspace 走。放进同一个 Docker 镜像作为独立进程或 sidecar，私有化客户升级 Workspace 就自动获得 MCP，SaaS 实例 `space.univer.ai` 同理。

### 5.2 工具集

直接沿用 DSH 插件和 CLI 已验证的工具语义，控制在十个左右，写入默认进 Worktree：

| 工具 | 作用 | 只读 |
| --- | --- | --- |
| `workspace_search` | 搜索 Space、文档、Issue | 是 |
| `workspace_browse` | 列出 Space 与目录 | 是 |
| `document_inspect` | 文档概览、Sheet 区域取值，分页并带单元格上限 | 是 |
| `api_reference` | 按主题返回 Facade API 参考（相当于 `uvw api` 与 Skills） | 是 |
| `worktree_create` | 为一个任务创建 Worktree 并加入文档 | 否 |
| `document_execute` | 在 Worktree 中执行 Facade JS 并提交，返回变更摘要 | 否 |
| `document_create` | 在 Worktree 中新建文档，或从 Markdown 生成 | 否 |
| `worktree_ready` | 标记待评审，返回评审链接 | 否 |
| `file_import` / `file_export` | 通过 Blob 上传会话导入 Office 文件，导出返回下载链接 | 否 |
| `issue_*` | 读写 Team Space Issue | 部分 |

刻意不暴露的能力：`merge`、`discard`、直接写 trunk。这些留给人在 Workspace 网页里完成。
理由见 5.4 节。

`document_execute` 就是 code mode。它继承 CLI 的成熟流程（同步 Worktree、执行、外置图片为 Asset、提交、冲突重试），
也继承 CLI 的 Skills 内容。`api_reference` 把 `apps/cli/skill-data` 里的知识以工具形式提供，
这样不支持 Skill 的 agent（ChatGPT、WorkBuddy）也能学会写 Facade 脚本。

### 5.3 服务端执行带来的新风险

这是本方案最需要认真对待的地方。今天 agent 写的 JS 跑在用户自己的电脑上，出了问题只影响用户自己。
搬到服务器后，它变成**多租户环境里执行不可信代码**。必须做到：

- worker 进程级隔离，没有文件系统和任意网络访问，只能通过受控通道访问 Workspace API 和协同端点。
- 每次执行限 CPU 时间、内存和 mutation 数量，超限即终止。
- worker 不跨用户复用，或在复用前彻底重置；执行身份始终是调用者自己，Server 照常做 ACL 校验。
- 可以考虑 V8 isolate（如 `isolated-vm`）或独立容器，选型需要原型验证。

Figma 的 `use_figma` 和 Cloudflare Code Mode 证明这条路可行，但它们都是专门投入做的沙箱。这部分工作量不能低估。

### 5.4 写入安全：Worktree 就是业界羡慕的“建议模式”

业界在 agent 写入安全上的探索，大多是在已有产品里补“草稿”能力。Google Docs 的 SUGGEST 模式刚推出，
包装库作者就报告了“未开通的项目会静默直接写入”这类坑。一篇 2026 年的论文指出，由模型自己填 `confirm=true`
不算人工确认，推荐失败即关闭或带外审批页面（arXiv 2611.02527，单一来源）。

Workspace 的 Worktree 天然满足这些要求：

- 所有 agent 写入进入隔离草稿，trunk 不受影响。
- `worktree_ready` 返回评审链接，用户在 Workspace 网页里看 diff 并合并，这就是带外审批。
- 工具标注 `readOnlyHint`，ChatGPT 对写工具默认要求用户确认，Claude 可按工具设置。

这是我们相对 Notion、飞书等的真实优势，应该在产品叙事里讲出来。

### 5.5 认证改造清单

最小可用版本可以复用现有 OAuth：MCP 应用作为资源服务器，Workspace 作为授权服务器，
token 端点签发的 session token 由 MCP 应用以 cookie 形式转发给 Workspace。要让 Claude 和 ChatGPT 能接上，
至少要补：

1. `/.well-known/oauth-protected-resource`（MCP 应用侧），未认证时返回带 `resource_metadata` 的 `401`。
2. `/.well-known/oauth-authorization-server`（Workspace 侧）。
3. CIMD 支持，并保留 DCR 兼容 Cursor 等仍依赖 DCR 的客户端。或者先为 Claude、ChatGPT 预注册静态客户端，回调地址写死。
4. refresh token。7 天后让用户在 ChatGPT 里重新授权，体验很差。
5. scope 拆分，至少分出 `read`、`worktree:write`、`blob:write`。`session` 等于全部权限，不适合交给第三方 agent。
6. token 受众绑定（RFC 8707），防止发给 MCP 的 token 被拿去直接调别的服务。
7. 个人访问令牌，给 WorkBuddy 等只支持请求头的客户端。用户在 Workspace 设置页生成，可设 scope 和过期时间，可随时吊销。

长期看，Workspace API 本身接受 Bearer token 会更干净，CLI 也能受益。但这不是第一步的前提。

### 5.6 文件进出

远程 MCP 读不到用户本机文件，这是 CLI 能做而远程做不到的事。可行的替代：

- **导入。** 工具返回一个 Blob 上传会话链接，用户点开上传；或者 agent 本身持有文件时（ChatGPT、Claude 都能接收用户上传），
  用 MCP Apps 的界面完成上传。具体到各客户端如何把附件交给工具，需要原型验证。
- **导出。** 返回带签名的下载链接，Workspace 已有 Blob 下载能力。
- **截图与 PDF。** 需要服务端 Chromium，放到第二阶段。很多场景可以用 MCP Apps 直接展示实时渲染，替代截图。

### 5.7 让对话里直接出现文档：MCP Apps

这是最能提升体验的一步。`packages/unit-comparison-viewer` 已经能渲染“已解码 UnitData 加比较结果”，
而且它的设计就是由宿主注入数据和 Univer factory。把它包装成一个 MCP App：

- `worktree_ready` 之后，ChatGPT 或 Claude 在对话里直接显示改动前后的对比卡片，点开是全屏预览。
- 用户不离开对话就能判断 agent 改得对不对，再点“去 Workspace 合并”。

需要验证的细节：Univer 渲染包在各宿主 CSP 下能否运行，图片与协同域名需要在 `connectDomains` 里声明。
目前没找到在 Claude 或 ChatGPT 对话里嵌入可编辑表格的生产案例，只读预览风险更低，应该先做只读。

## 6. 本机路线的正确做法

本机路线仍然有价值：内网部署不想开公网入口、离线环境、开发者希望用自己的机器算力。
做法上要吸取 CLI 的教训，**去掉用户侧的运行时依赖**，而不是换一个协议：

1. **单文件 `uvw`。** 用 Node SEA 或 Bun `--compile` 打包成单文件可执行，原生绑定作为资源嵌入，运行时解压后 `dlopen`。
   Node SEA 文档明确支持这种方式；Bun 对依赖旁路动态库的插件有已知问题。需要逐个验证三个绑定。
2. **`uvw mcp` 子命令。** 同一个二进制以 stdio 方式提供与远程版相同的工具集，登录沿用 `uvw auth login`。
   CLI 与本机 MCP 合一，不新增产品。
3. **安装体验。** macOS 与 Windows 提供签名的安装包或一行安装脚本；Cursor 与 VS Code 提供一键安装链接；
   WorkBuddy 与 CodeBuddy 的插件市场接受 `.claude-plugin/` 格式，可以一并上架。
4. **Claude Desktop 的 `.mcpb`。** Claude Desktop 自带 Node，`.mcpb` 双击即装，看起来很合适。但要注意两点：
   `.mcpb` 不会执行 `npm install`，必须把所有平台的 `.node` 一起打进包里，单包可能超过 100 MB；
   清单只能按操作系统区分，不能按 CPU 架构区分，需要启动脚本按 `process.arch` 选择。
   另有第三方资料称 Claude 连接器目录已不再收 `.mcpb`（未核实）。优先级低于单文件二进制。

本机路线解决的是“没有 Node”，解决不了“不在 ChatGPT 网页和手机上”。所以它是补充，不是主路线。

## 7. 更巧妙的入口

### 7.1 “连接到 AI 助手”设置页

技术方案再好，用户也得知道怎么接。在 Workspace 里加一个设置页，按客户端给出最短路径：

- Claude：显示 MCP URL 和复制按钮，配三步截图；进入 Claude 连接器目录后改为一键添加。
- ChatGPT：同上；进入插件目录后改为一键添加。
- Cursor、VS Code：一键安装链接。
- WorkBuddy、Kimi 等：生成带 scope 的个人访问令牌，直接给出可粘贴的 `mcp.json` 片段。
- 内网部署：自动检测是否从公网可达，不可达时说明只能用本机客户端，或给出放行 Anthropic、OpenAI IP 的指引。

这是成本最低、对非开发者最友好的一步。Notion、Linear 的文档首页都是这个思路。

### 7.2 上架目录

Claude 连接器目录支持“按客户 URL”模式，一条目录项可以服务所有私有化部署，但需要 Verified 标签和更长的审核。
ChatGPT 插件目录、WorkBuddy 插件市场、Microsoft 的 Copilot 连接器同理。上架后，用户在 agent 里搜“Univer”就能找到，
这比任何安装说明都低门槛。

### 7.3 Skill 与 MCP 组合

Skill 讲工作流（何时开 Worktree、怎样验证、何时交给人），MCP 提供能力。仓库已有 `skills/univer-workspace-cli/SKILL.md`。
为 MCP 写一份对应的 Skill，同时把同样的指引写进 MCP 的 server instructions 和 `api_reference` 工具，
覆盖支持 Skill 的 agent（Claude、Codex、Cursor、Copilot、Gemini CLI，这些已采用 agentskills.io 标准）和不支持的 agent。

### 7.4 用对话链接代替安装

Issue 和分享链接可以带一个“在 Claude 中处理”“在 ChatGPT 中处理”的按钮，打开对应 agent 并预填提示词和文档引用。
用户的第一次使用来自一个具体任务，而不是一份安装说明。各 agent 是否支持带预填内容的深链需要逐个确认。

### 7.5 agent 型工具作为补充

在工具型 MCP 稳定后，可以加一个 `workspace_ask` 之类的工具，由我们的服务端 agent 完成复杂的多文档任务，
按次计费或计入套餐。Glean 的经验是这类工具只适合不需要人工交互的只读或问答任务，有写入和审批的流程不适合包成一次工具调用。
它也是 DSH Agent 能力的一个自然出口。

### 7.6 WebMCP

Workspace 网页通过 `document.modelContext` 暴露工具，浏览器里的 agent 直接操作用户已打开的文档，复用浏览器里现成的 Univer 实例，
服务端零执行成本。目前只有 Chrome origin trial 和 Gemini in Chrome 支持，默认未开启。值得跟踪，现在不投入。

## 8. 分阶段路线

每一阶段都以真实客户端里的端到端演示作为验收，不以单测通过为准。

**阶段 0：原型（约一到两周）。** 目标是回答三个只能靠实验回答的问题。

1. 用 `client-core` 搭一个最小 MCP 应用，只有 `document_inspect`、`worktree_create`、`document_execute`、`worktree_ready` 四个工具，
   用现有 OAuth 加静态预注册客户端，部署到可公网访问的测试实例。
2. 在 Claude、ChatGPT、Cursor、WorkBuddy（PAT）里各跑通一次“改一个表格并交给人评审”的任务，记录卡点。
3. 测量一次 `document_execute` 的冷启动与热启动耗时、内存占用，推算单实例能承载的并发。
4. 用 `isolated-vm` 或进程隔离各试一次，确认沙箱方案的可行性和开销。

**阶段 1：可用版本。** 补齐 5.5 节的认证改造（metadata、CIMD/DCR、refresh token、scope、PAT），
完成执行沙箱与配额，加上导入导出，上线“连接到 AI 助手”设置页，在 `space.univer.ai` 开放。

**阶段 2：体验。** MCP Apps 只读预览与对比卡片；提交 Claude、ChatGPT、WorkBuddy 目录；服务端截图与 PDF；
发布配套 Skill。

**阶段 3：补充入口。** 单文件 `uvw` 与 `uvw mcp`，满足内网和离线；视需求做 `.mcpb`；评估 agent 型工具与 WebMCP。

阶段 0 的结果可能推翻部分结论。例如如果服务端执行的单次成本或沙箱复杂度超出预期，就需要重新权衡远程与本机的比重。

## 9. 需要你拍板的问题

已决定（2026-11-07）：先 SaaS；接受服务端执行模型生成的代码；先做用量统计，计费以后设计；DSH Agent 继续作为独立产品。

原始问题如下：

1. **先 SaaS 还是先私有化？** SaaS 实例上远程 MCP 对所有客户端都是一个 URL；私有化部署要么开公网入口，要么只能用本机客户端。
   建议先在 `space.univer.ai` 做通，私有化客户第二步。
2. **是否接受在服务器上执行模型生成的代码？** 这是本方案的核心代价。如果不接受，远程 MCP 只能做浏览、Issue、Worktree 管理和导入导出，
   编辑仍要回到本机。另一条路是只提供有限的高层编辑工具（如腾讯文档的“从 Markdown 生成”），放弃 code mode 的表达力。
3. **配额与计费。** 执行器成本按什么口径计入套餐：按执行次数、按执行时长，还是按编辑连接数（与现有 trial 配额一致）。
4. **DSH Agent 的定位。** 远程 MCP 上线后，DSH Agent 是继续作为完整的独立产品，还是收缩为 agent 型工具的后端和高级用户入口。

## 10. 参考资料

本仓库：

- `apps/cli/src/main.ts`、`apps/cli/src/product-commands.ts`、`apps/cli/src/program.ts`：CLI 命令分层。
- `packages/client-core/src/content-runtime.ts`、`content-worker.ts`、`auth.ts`：执行与提交流程、CLI 登录。
- `apps/cli/scripts/package-artifact.mjs`：原生依赖与打包。
- `apps/workspace/server/src/modules/identity/oauth-authorization-router.ts`、`oauth-clients.ts`、`config.ts`：现有 OAuth。
- `apps/workspace/server/src/integrations/univer/unit-store.ts`、`exchange.service.ts`：服务端 headless Univer。
- `apps/workspace/contracts/http/paths/worktrees.yaml`：Worktree 生命周期与 changeset 提交。
- `packages/dsh-univer-workspace-plugin/README.md`：现有 agent 工具集。
- `apps/agent/README.md`：Workspace Agent 的分发与 OAuth。

协议与客户端：

- [MCP 2025-11-25 changelog](https://modelcontextprotocol.io/specification/2025-11-25/changelog)、[授权规范](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)
- [MCP 2026-07-28 发布说明](https://blog.modelcontextprotocol.io/posts/2026-07-28/)
- [Claude 自定义连接器](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp)、[连接器认证](https://claude.com/docs/connectors/building/authentication)、[Anthropic IP 范围](https://platform.claude.com/docs/en/api/ip-addresses)
- [Anthropic MCP tunnels](https://platform.claude.com/docs/en/agents-and-tools/mcp-tunnels/overview)
- [ChatGPT 连接 MCP](https://developers.openai.com/plugins/deploy/connect-chatgpt)、[ChatGPT UI（MCP Apps）](https://developers.openai.com/plugins/build/chatgpt-ui)、[OpenAI tunnel-client](https://github.com/openai/tunnel-client)
- [Microsoft 365 Copilot 配置 MCP 插件](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/configure-plugin-mcp-servers)
- [WorkBuddy MCP 配置](https://www.workbuddy.ai/docs/cli/mcp)、[CodeBuddy 插件](https://www.codebuddy.ai/docs/cli/plugins)
- [Cursor 安装链接](https://cursor.com/docs/mcp/install-links)、[VS Code MCP Apps 支持](https://code.visualstudio.com/blogs/2026/01/26/mcp-apps-support)

本机分发：

- [MCP Bundles（mcpb）](https://github.com/modelcontextprotocol/mcpb)、[Anthropic Desktop Extensions](https://www.anthropic.com/engineering/desktop-extensions)
- [Node 单文件可执行](https://nodejs.org/api/single-executable-applications.html)
- [MCP Registry 包类型](https://modelcontextprotocol.io/registry/package-types)
- [Claude Skills 概览](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview)、[claude.ai 出网设置](https://support.claude.com/en/articles/12111783-create-and-edit-files-with-claude)

同类产品：

- [Notion 托管 MCP 内幕](https://www.notion.com/blog/notions-hosted-mcp-server-an-inside-look)
- [Figma 写入画布](https://developers.figma.com/docs/figma-mcp-server/write-to-canvas)、[Figma 速率限制](https://developers.figma.com/docs/figma-mcp-server/rate-limits-access/)
- [Linear MCP](https://linear.app/docs/mcp)、[Atlassian Rovo MCP](https://github.com/atlassian/atlassian-mcp-server)
- [Google Workspace MCP 配置](https://developers.google.com/workspace/guides/configure-mcp-servers)、[Docs 建议模式](https://developers.google.com/workspace/docs/api/how-tos/suggestions)
- [Microsoft Work IQ MCP](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/work-iq/mcp/overview)
- [飞书 MCP 概览](https://open.larkoffice.com/document/uAjLw4CM/ukTMukTMukTM/mcp_integration/mcp_introduction)、[腾讯文档 MCP](https://docs.qq.com/open/document/mcp/)
- [Glean agents as tools](https://docs.glean.com/administration/platform/mcp/agents-as-tools)
- [Anthropic：为 agent 写工具](https://www.anthropic.com/engineering/writing-tools-for-agents)
- [arXiv 2611.02527](https://arxiv.org/html/2611.02527)
