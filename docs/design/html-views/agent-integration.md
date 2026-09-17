# Agent 集成

[返回集成概览](README.md)

## 页面生成与交付

Workspace Agent 通过能力插件的 `univer_html_view` 工具验证和发布页面。Agent 先检查真实
来源 Sheet，再生成会话目录中的 `.univer.html` 文件，调用工具验证，最后创建 Workspace Blob。

[页面生成 Skill](../../../packages/dsh-univer-workspace-plugin/skills/univer-html-view/SKILL.md)
提供 Agent 所需的创作指引：普通展示和输入使用 HTML 绑定属性，自定义交互使用 JavaScript，
自定义展示在消费数据的元素上声明 `data-univer-cell-subscribe` 或 `data-univer-range-subscribe`，
通过 `subscribeCellById()` / `subscribeRangeById()` 注册回调。独立指标分别声明单元格，列表和图表
各自声明所需范围，使 DOM 可以追踪元素与来源的绑定关系；样式使用 CSS。工具和 Skill 随 Agent 插件交付，示例必须匹配插件与 Browser 消费的 SDK 版本。
SDK 完整语法与接口引用[上游文档](README.md#sdk-文档)。

## 工具与 Workspace 的边界

[工具实现](../../../packages/dsh-univer-workspace-plugin/src/tools/html-view.ts)
复用发布包的 `parseHtmlView()` 和 `getHtmlViewUnitIds()`，再接入 Workspace 资源与上传流程。

| 操作 | Workspace 集成行为 | 结果 |
| --- | --- | --- |
| `validate` | 读取会话内文件，解析声明式引用，以当前用户访问来源 Sheet 的 trunk 数据，检查子表存在和单元格或范围末端坐标 | 验证结果、静态 Unit 列表与绑定数量 |
| `create` | 执行相同验证，解析目标 Space 与目录，通过既有 Blob 上传流程提交原始 HTML | 新 Blob 及其 Workspace 访问地址 |

`create` 要求文件名和 `idempotencyKey`；仅重试相同内容与目标时复用该 key。
文件路径由会话路径规则解析，目标 Space 默认使用当前关联 Space。模板读取支持取消，
工具在上传前再次检查取消状态；上传过程复用通用 Blob 服务。

验证只覆盖声明式引用。JavaScript 可以在运行时请求其他 Unit，这些请求由 Browser 或 Agent 页面宿主按访问者
身份授权；`validate` 不执行脚本，也不证明页面交互已经正常运行。作者有权访问来源不代表
所有页面访问者都有权访问。

HTML Blob 不使用 Unit Worktree。`create` 发布独立文件，不写入来源单元格。修改已有页面时，
先用 `univer_blob download` 取得 HTML 和对应 ETag，修改模板并通过 `univer_html_view validate`，
再用 `univer_blob replace` 提交原 Resource ID、新 HTML、下载时的 ETag 和本次更新的
`idempotencyKey`。替换立即发布，保留 Node、Resource、权限与原链接；只有需要独立页面时才
再次创建 Blob。ETag 冲突时重新下载并协调内容，不能直接套用新 ETag 覆盖较新的页面。

## CLI 集成

Workspace CLI 通过 `html-view validate/create` 组合相同版本的解析包、Client Core trunk runtime
与 Blob 上传。文件使用本机路径，创建必须显式指定 Space、名称和幂等键。CLI 上传已验证字节的
临时副本，避免验证期间源文件变化导致发布未验证内容；完成或失败后清理副本，恢复信息指向原文件。
来源只读取 trunk；创建不写来源单元格。修改现有页面使用 `blob download → html-view validate → blob replace`。

详细操作与创作指引随独立 [HTML View Skill](../../../apps/cli/skill-data/html-view/SKILL.md) 交付。
CLI 不装配 Browser Renderer 或 Binding Engine；页面通过 Workspace Browser 或 Agent Sidecar 运行。

## 集成交付检查

升级发布包或修改 Agent 生成指引时，检查实际打包的插件及其 Skill，并在真实 Workspace
服务上验证以下链路：

- Agent 检查来源、生成文件、调用 `validate` 和 `create`，返回可打开的页面地址。
- Browser 打开生成页面，HTML 绑定和 JavaScript 交互能读取、写入并保存来源数据。
- 原生 Sheet 或另一个 HTML 页面能接收协同更新；只读访问者的写入得到明确错误。
- 离开页面时的草稿提交、失败提示和重新打开后的数据符合保存结果。

工具验证、Browser 运行和服务端保存分别检查；只有解析成功不能代表整条集成链路通过。

## Agent Sidecar 页面运行

Agent 文件预览先按 `originalFilename` 识别 `.univer.html`，再走普通文本预览。
专用适配读取完整 Blob，并通过共享 `workspace-html-viewer` 调用 SDK `renderHtmlView` 渲染。
SDK 包已包含 iframe 程序，Agent 无需 runtime 构建插件。普通 `.html` 仍显示文本源码。

“检查绑定”开关控制 SDK 内置面板、hover 卡片和高亮。名称来自已授权加载的 Workbook，
缺失时显示 `id: xxx`。检查界面使用打开页面时的 Agent 中英语言；语言变化不重建正在
编辑的页面，重新打开后生效。

Agent 适配调用共享 `createWorkspaceHtmlEngine`，复用基础插件装配、只读保护与加载/取消/释放生命周期。
Agent 通过同源 `/univer-workspace/api/unit-resources/{unitId}`
解析来源，再调用 Resource open 获取权威 `editorMode`。每个来源独立授权，仅支持
Sheet trunk；只读来源的单元格写入和追加行均明确报错。协同使用现有
`/univer-workspace/collab` 代理、当前用户、license 和 SDK collaboration-embed
引用 provider；连接版本沿用 Agent 的 fetch/WebSocket fence，不向 iframe 传递凭据。

当前发布的 DSH Sidecar API 无异步关闭保护，且切换会话会卸载内容。Agent 将
HTML iframe 保留在稳定的 DOM 容器内，位置跟随 Sidecar；关闭、切换文件或会话时
等待 `prepareToLeave()` 提交并暂停写入，成功后释放。失败时保留页面和“保存并关闭”重试入口，也允许用户确认后放弃尚未同步的更改
（不会撤销已保存的更改）。保存过程中
禁止继续交互，浏览器退出时检查未保存内容和未同步状态。账号切换仍受原有连接隔离
及页面重载机制约束，浏览器/进程强制退出无法保证保存。未来 DSH 提供公开异步
leave guard 后可移除此保留适配，不修改共享组件或 SDK 协议。

用户在页面中交互按来源权限直接写入 trunk；Agent 校验、上传 HTML 不修改来源
Sheet，HTML Blob 仍不进入 Unit Worktree。
