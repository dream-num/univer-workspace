# Agent 集成

[返回集成概览](README.md)

## 页面生成与交付

Workspace Agent 通过能力插件的 `univer_html_view` 工具验证和发布页面。Agent 先检查真实
来源 Sheet，再生成会话目录中的 `.univer.html` 文件，调用工具验证，最后创建 Workspace Blob。

[页面生成 Skill](../../../packages/dsh-univer-workspace-plugin/skills/univer-html-view/SKILL.md)
提供 Agent 所需的创作指引：普通展示和输入使用 HTML 绑定属性，自定义交互使用 JavaScript，
样式使用 CSS。工具和 Skill 随 Agent 插件交付，示例必须匹配插件与 Browser 消费的 SDK 版本。
SDK 完整语法与接口引用[上游文档](README.md#sdk-文档)。

## 工具与 Workspace 的边界

[工具实现](../../../packages/dsh-univer-workspace-plugin/src/tools/html-view.ts)
复用发布包的 `parseHtmlView()` 和 `getHtmlViewUnitIds()`，再接入 Workspace 资源与上传流程。

| 操作 | Workspace 集成行为 | 结果 |
| --- | --- | --- |
| `validate` | 读取会话内文件，解析声明式引用，以当前用户访问来源 Sheet 的 trunk 数据，检查子表存在和坐标范围 | 验证结果、静态 Unit 列表与绑定数量 |
| `create` | 执行相同验证，解析目标 Space 与目录，通过既有 Blob 上传流程提交原始 HTML | 新 Blob 及其 Workspace 访问地址 |

`create` 要求文件名和 `idempotencyKey`；仅重试相同内容与目标时复用该 key。
文件路径由会话路径规则解析，目标 Space 默认使用当前关联 Space。模板读取支持取消，
工具在上传前再次检查取消状态；上传过程复用通用 Blob 服务。

验证只覆盖声明式引用。JavaScript 可以在运行时请求其他 Unit，这些请求由 Browser 按访问者
身份授权；`validate` 不执行脚本，也不证明页面交互已经正常运行。作者有权访问来源不代表
所有页面访问者都有权访问。

HTML Blob 不使用 Unit Worktree。`create` 发布独立文件，不写入来源单元格。修改已有页面时，
先用 `univer_blob download` 取得 HTML 和对应 ETag，修改模板并通过 `univer_html_view validate`，
再用 `univer_blob replace` 提交原 Resource ID、新 HTML、下载时的 ETag 和本次更新的
`idempotencyKey`。替换立即发布，保留 Node、Resource、权限与原链接；只有需要独立页面时才
再次创建 Blob。ETag 冲突时重新下载并协调内容，不能直接套用新 ETag 覆盖较新的页面。

## 集成交付检查

升级发布包或修改 Agent 生成指引时，检查实际打包的插件及其 Skill，并在真实 Workspace
服务上验证以下链路：

- Agent 检查来源、生成文件、调用 `validate` 和 `create`，返回可打开的页面地址。
- Browser 打开生成页面，HTML 绑定和 JavaScript 交互能读取、写入并保存来源数据。
- 原生 Sheet 或另一个 HTML 页面能接收协同更新；只读访问者的写入得到明确错误。
- 离开页面时的草稿提交、失败提示和重新打开后的数据符合保存结果。

工具验证、Browser 运行和服务端保存分别检查；只有解析成功不能代表整条集成链路通过。
