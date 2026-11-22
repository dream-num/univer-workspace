# HTML View 本地预览调试器：需求分解

状态：已采纳，实施中（2026-11-22）。路由名 `/html-view-preview`，默认试算，`dryRun` 作为 `html_view_save` 的参数；Safari 若无法访问本机则只支持文件选择。

## 1. 目标

Agent 写 HTML View 时，现在只能在 `html_view_save` 之后打开草稿预览，才知道页面长什么样。保存前的校验只检查绑定能否解析，看不到画面，也发现不了运行时错误，结果像开盲盒。待发布的新页草稿又无法原地修订（Phase E 的 E5），所以每改一次就多一份草稿。

本需求让 agent 和用户在保存之前，先在本地预览带实时数据的页面，确认效果后再保存。目标是三条：

- 保存前能看到真实效果。人看画面，agent 读结构化诊断。
- 调试不改真实数据，也不产生多余草稿。
- 没有 Node 的非开发者不受影响，仍然走草稿预览。

## 2. 已验证的事实

| 事实 | 依据 |
| --- | --- |
| 本地进程只供文件、浏览器用自己的登录渲染，这个结构可行。读取、外部修改实时同步、页面写回、保存文件后 184 ms 自动刷新、PR 数据都已跑通 | 原型 `cx-lightpreview`，verify-uvw，证据在 `.poteto-agent/verify/lightpreview/` |
| `preview.mjs` 是单文件，3,525 字节，只用 Node 标准库，最低 Node 18.2，启动 45 ms，不持有凭据 | 同上 |
| Chrome 154 默认拦截 https 页面访问 `127.0.0.1`（本地网络访问权限）。一次性授予 `local-network-access`、`loopback-network`、`local-network` 后，fetch 和 EventSource 都可用 | 用 CDP 模拟授权的对照实验，`evidence/08-lna-grant-*` |
| 待发布的新页草稿无法用 `html_view_read` 读取，服务端也不会因同名而作废旧草稿 | Phase E LobsterAI 第 2 次运行，以及 `drafts.service.ts` 和 SQLite 仓库代码 |
| 绑定校验在 client-core 里用 headless 运行时完成，服务端没有给浏览器调用的 validate 接口 | `packages/client-core/src/html-view.ts` |
| 浏览器 Agents 已有 render check：状态分 `passed`、`issues`、`timed-out`、`failed`，能收集未捕获错误、console error 和页面上显示的错误提示 | `apps/workspace/web/src/features/html-views/render-check.ts` |
| WorkBuddy 自带 Node 22 和 Python 3.13，agent 的 shell 里可以用；LobsterAI 自带 Node；QwenWork 待确认 | Phase E transcript 与本机文件 |

## 3. 使用场景

| 场景 | 预览方式 |
| --- | --- |
| 开发型 agent（Claude Code、Codex 等），或自带 Node 的桌面 agent | `preview.mjs` 加 Workspace 预览路由，保存文件即自动刷新，诊断回传给 agent |
| 有浏览器、没有 Node 的用户 | 打开预览路由，选择或拖入本地文件。Chrome 和 Edge 尽量做到自动刷新，其他浏览器每次重新选择 |
| 没有本地 shell 的 MCP 客户端（网页版等） | 不走本地预览。先 `dryRun` 校验，再保存草稿，用草稿预览确认，再在同一份草稿上修订 |

## 4. 整体流程

1. Agent 读数据、选风格，把页面写成本地文件 `page.univer.html`。
2. 有 Node 时运行 `node preview.mjs page.univer.html`。它打印一行 JSON，里面是预览地址，agent 把地址交给用户，或用自己的浏览器工具打开。
3. 浏览器打开 Workspace 预览路由，用户确认信任后，页面以试算模式连接实时数据并渲染。
4. 路由运行渲染检查和绑定样本检查，把诊断回传给 `preview.mjs`。`preview.mjs` 在标准输出里每次打印一行 JSON，agent 读到后修改文件。
5. 文件保存后，预览自动刷新，重新检查。
6. 诊断通过、用户认可后，agent 用同一份内容调用 `html_view_save`。诊断里带的内容哈希，可以用来核对保存的就是预览过的那一版。

## 5. 数据形状

预览路由回传给 `preview.mjs` 的诊断报告：

```ts
type LocalPreviewReport = {
  token: string;              // preview.mjs 启动时生成的配对令牌
  sha256: string;             // 本次渲染的 HTML 内容哈希
  renderCheck: {              // 复用现有 renderCheckSchema
    status: "passed" | "issues" | "timed-out" | "failed";
    issues: { kind: string; message: string }[];
    durationMs: number;
  };
  bindings: {                 // 每个绑定从已加载引擎读到的样本，最多 60 个
    attribute: string;        // data-univer-cell-text 等
    reference: string;        // 原始引用
    sample: unknown;          // 读到的值或首行
    warnings: ("empty" | "header-text" | "formula-under-control" | "date-serial")[];
  }[];
  leftoverPlaceholders: string[]; // 数据到达后页面上仍可见的加载或占位文本
  viewport: { width: number; height: number };
  writeMode: "trial" | "saved";
};
```

`preview.mjs` 的标准输出合同是每行一个 JSON 对象：

- 启动时：`{"event":"ready","url":"...","file":"...","token":"..."}`
- 每次收到报告：`{"event":"report", ...LocalPreviewReport}`
- 浏览器在限定时间内没有连上：`{"event":"waiting","seconds":N}`

另外提供 `GET /report?token=...`，返回最近一次报告，供不方便读进程输出的 agent 使用。

## 6. 需求分解

### 阶段 0：先验证的未知项

| 编号 | 内容 | 验收 |
| --- | --- | --- |
| S1 | 在有界面的 Chrome 和 Edge 上实测本地网络授权弹窗：弹窗文案、授权的持久性、拒绝后能否恢复 | 已完成（Chrome 154，Edge 未装）：本机访问必须由用户点击发起，弹窗标题为「<站点> wants to」，内容为「Access other apps and services on this device」，有 Block 和 Allow。允许后无需刷新即可访问，刷新和重启浏览器后仍有效，EventSource 也可用。拒绝或多次关闭后，请求立即以「Failed to fetch」失败，页面无法与服务未启动区分；恢复路径是站点设置里的「Local network」和「Apps on device」两项改为允许。没有 CORS 或 PNA 预检 |
| S2 | Safari、Firefox 能否从 https 页面读取 `http://127.0.0.1` 的内容并连接 EventSource | 每个浏览器给出「可用」「需设置」或「不可用」的结论和证据 |
| S3 | 文件选择方式：Chrome 和 Edge 用 File System Access 保留文件句柄并定时检查修改时间来刷新；Safari 和 Firefox 只做一次性载入 | 已完成（Chrome 154）：拖入文件得到的 `getAsFileSystemHandle()` 句柄能读到之后的修改，原子重命名保存也可以；`getAsFile()` 和 `<input type=file>` 得到的 File 在文件修改后读取报 `NotReadableError`，只能重新选择。`showOpenFilePicker` 需要原生对话框，无法在 headless 下驱动。Safari、Firefox 未测 |
| S4 | 生产环境的 CSP 和 Permissions-Policy 是否允许路由访问本机地址 | 已完成：2026-11-22 生产环境首页和草稿页的响应都没有 CSP 和 Permissions-Policy，HTML 里也没有 meta CSP；服务端只给草稿内容、资源和独立应用路由设置 CSP。路由无需改响应头 |
| S5 | LobsterAI 和 QwenWork 的 agent shell 里 `node` 是否可用、版本多少 | 已完成一半：LobsterAI 的 shell 里 `node --version` 为 v24.19.0，`node` 是应用自带 Electron 的封装（`ELECTRON_RUN_AS_NODE=1`），不依赖系统 Node。QwenWork 积分耗尽，未测 |

阶段 0 的结论决定 W1 和 W6 的范围。如果 S2 表明 Safari 不可用，Safari 用户走文件选择方式。由 S1，路由的第一次本机读取要放在信任确认的点击里发起，使信任确认和浏览器授权合为一次操作。由 S3，拖入文件用文件句柄实现自动刷新，其他方式只做一次性载入并提供重新选择。

### 阶段 1：服务端和 MCP

| 编号 | 内容 | 验收 |
| --- | --- | --- |
| M1 | `html_view_save` 增加 `dryRun: true`：只做校验并返回 `bindings` 样本，不创建草稿。这样没有浏览器的 agent 也能在保存前拿到结构化检查 | MCP 测试覆盖：`dryRun` 返回样本、不产生草稿记录，非法绑定返回与正常保存相同的错误 |
| M2 | 待发布草稿的原地修订：`html_view_save` 接受待发布草稿的 ID（例如 `draft` 参数），新草稿取代旧草稿，旧草稿标记为已取代，旧预览地址指向新草稿或提示已被取代 | 服务端测试、MCP 测试、浏览器草稿页回归测试；用 Phase E 的改风格场景复测，同一页面只保留一份待发布草稿 |
| M3 | 修正 creator 中「Pending revisions keep name/space to retire the older draft」的说法，改为 M2 的流程 | Skill 测试更新 |

M2 涉及草稿状态、数据库和浏览器，需要先单独写设计，并按 `apps/workspace/AGENTS.md` 跑迁移矩阵。

### 阶段 2：Workspace 预览路由

| 编号 | 内容 | 验收 |
| --- | --- | --- |
| W1 | 新路由（暂名 `/html-view-preview`）。内容来源有两种：一是 `src` 加 `token`，`src` 只接受带明确端口的 `127.0.0.1` 或 `localhost`，不跟随重定向，不带凭据；二是选择或拖入本地文件。必须已登录 | 单元测试覆盖来源校验；拒绝非本机地址；未登录时跳转登录并带回原地址 |
| W2 | 信任确认：首次加载时显示文件名、来源，以及页面绑定的表和工作表名称，并说明「将以你的身份读取这些表」。用户确认后才连接数据 | 未确认前不加载任何数据，测试断言此时没有发起协同连接 |
| W3 | 写入模式：默认试算，沿用现有草稿的试算语义，页面写入不保存，界面明确标注。用户可以切换为「写入真实数据」，切换前二次确认。带 `repo` 和 `pr` 时读取 PR 数据，只允许试算 | 默认模式下页面写入不改变源表（用 CLI 独立读回）；切换后写入可读回 |
| W4 | 诊断面板：复用 render check；从已加载引擎读取每个绑定的样本，并检查空值、表头文字、表单控件绑到公式单元格、日期序列号这几类问题；检测数据到达后残留的占位文本；提供 360、390、1440 三档视口切换 | 用故意写错的页面（错位引用、残留「加载中」、未捕获异常）验证每类问题都能报出 |
| W5 | 诊断回传：每次渲染检查完成后，带上令牌和内容哈希，POST 到 `src` 同源的 `/report` | `preview.mjs` 收到的报告与面板显示一致 |
| W6 | 本地网络授权引导：读取失败时判断是否被浏览器拦截，给出授权步骤（按阶段 0 的结论分浏览器给出），并提供改用文件选择的入口 | Chrome 上未授权和已授权两种状态各有截图 |
| W7 | 中英文文案，沿用现有 i18n | 文案测试 |

路由只复用现有的 `HtmlView`、`render-check` 和绑定引擎，不新增渲染器，也不新增服务端接口。

### 阶段 3：`preview.mjs`

| 编号 | 内容 | 验收 |
| --- | --- | --- |
| P1 | 单文件，只用 Node 标准库，Node 18.2 及以上。只供一个文件，路径固定为启动参数；生成随机配对令牌，令牌和 Workspace 来源都不匹配的请求一律 403；只监听 `127.0.0.1` | 自带的 `--self-check` 用断言覆盖：来源校验、令牌校验、同目录其他文件 404 |
| P2 | 改动通知：监听文件变化，通过 EventSource 推送刷新 | 保存后预览自动刷新 |
| P3 | 诊断接收：`/report` 接收 W5 的报告，按第 5 节的合同写到标准输出，`GET /report` 返回最近一次报告 | agent 能从标准输出读到每次报告 |
| P4 | 参数：`--workspace <origin>`，默认 `https://space.univer.ai`；`--open` 调用系统命令打开浏览器；`--wait <秒>` 设定等待浏览器连上的时间，超时输出 `waiting` 事件 | 三个平台（macOS、Windows、Linux）都能打开浏览器 |
| P5 | 体积上限 8 KB，作为测试断言，防止脚本膨胀 | 测试 |

### 阶段 4：分发

| 编号 | 内容 | 验收 |
| --- | --- | --- |
| D1 | `html-view` Skill 增加 `scripts/preview.mjs` 资源。MCP 的 `skills_read` 可以读取，CLI 安装包里也包含这个文件。需要在 Skill 资源装配和相关测试里加入 `scripts/` 目录 | `skills_read {"name":"html-view","resource":"scripts/preview.mjs"}` 返回与源文件逐字相同的内容；CLI 包产物里包含该文件 |
| D2 | 「本地预览」reference，说明如何写出脚本、运行、读取报告、交给用户，以及没有 Node 时怎么做 | 引用路径和命令有测试校验 |

### 阶段 5：指引

| 编号 | 内容 | 验收 |
| --- | --- | --- |
| G1 | creator 的流程改为：写本地文件；有 Node 就运行预览并读取报告，修到诊断通过；没有 Node 就先 `dryRun`；最后保存。细节放在 D2 的 reference 里，creator 正文只加几句，增加不超过 800 字符 | Skill 测试；字符数断言 |
| G2 | Phase E 的小修：回复里说明选这个风格的理由；PR 关联的草稿说成「合并后自动上线」，而不是「点 Publish」 | Skill 测试 |
| G3 | 如果 agent 已经写了带绑定的本地 HTML，应当预览后保存为草稿，而不是让用户直接打开本地文件 | 列入阶段 6 的评测 |

### 阶段 6：验收

| 编号 | 内容 | 验收 |
| --- | --- | --- |
| A1 | verify-uvw 端到端：原型的全部检查，加上信任确认、试算模式默认不写入、诊断回传、`dryRun`、草稿原地修订 | 截图和 CLI 读回 |
| A2 | 生产环境部署后，在有界面的 Chrome 上实测授权流程和完整调试循环 | 截图 |
| A3 | 行为评测：沿用三个数据集和强弱两个模型，每格跑 2 次，比较有无调试器时最终保存的 render 问题数、保存次数和盲评分数 | 评测记录，写入设计文档 |
| A4 | 桌面 agent 实测：WorkBuddy 和 LobsterAI 各跑一次本地预览流程 | transcript 证据 |

## 7. 安全边界

- 凭据只存在于用户浏览器的 Workspace 会话里。`preview.mjs` 和本地文件都接触不到。
- 本地 HTML 是会执行的内容，并且以用户本人的权限运行。现有 sandbox 能防止它读取会话，但它仍可以通过绑定读写用户有权编辑的表。对策是三层：W2 的信任确认、W3 默认试算、P1 的配对令牌（防止其他网站或本机其他进程借用路由）。
- 路由只接受本机地址，但不能因此认定内容可信。信任确认是必需的，不能省略。
- `preview.mjs` 只监听 `127.0.0.1`，不能暴露到网络。

## 8. 不做的事

- 不做本地持有凭据的代理宿主，也不在本地打包绑定运行时（重原型已证明可行，但会让脚本带上凭据和 16 MB 的运行时）。
- 不做 Python 版或安装器。
- 不支持离线预览。
- 不在路由里提供「一键发布」。保存仍由 agent 调用 `html_view_save` 完成。

## 9. PR 切分和顺序

| 顺序 | PR | 依赖 |
| --- | --- | --- |
| 1 | 阶段 0 的验证记录（只写文档，不改代码） | 无 |
| 2 | M1 `dryRun` | 无 |
| 3 | M2 和 M3 草稿原地修订（先写设计） | 无 |
| 4 | W1 到 W7 预览路由，加上 P1 到 P5 的 `preview.mjs`。两者共用报告合同，放在同一个 PR 里做端到端验证 | 阶段 0 中 S1 和 S3 的结论只影响 W6 的文案，可以后补 |
| 5 | D1、D2、G1 到 G3 | 4 已部署 |
| 6 | A1 到 A4 验收和评测 | 2 到 5 |

2 和 4 互不依赖，从 `main` 各自开分支并行。3 和 2 都修改 `html_view_save`，在 2 合入后开始。5 依赖 4 的路由合同，按 stack 组织。

## 10. 需要决定的事

1. 路由名称：`/html-view-preview` 还是别的。
2. 默认试算是否合适。另一种做法是默认写入真实数据，与正式页面保持一致，但调试时有误改数据的风险。
3. 如果阶段 0 发现 Safari 无法访问本机，是否接受 Safari 只能用文件选择方式。
4. `dryRun` 作为 `html_view_save` 的参数，还是另设一个工具。设一个参数不会增加工具数量。
