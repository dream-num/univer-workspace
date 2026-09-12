# Univer HTML View Template

独立的 HTML 模板语言与解析 package，供 Browser 和 Agent 共用。`parseHtmlView()`
校验 `data-univer-cell-text/model`，解析 `unitId:sheetId:A1` 引用，返回清理后的 HTML
与结构化绑定列表。它只依赖 parse5，不加载 Univer、不访问 DOM 或应用服务。

`parseCellReference()` 将 A1 转为零基坐标；`getHtmlViewUnitIds()` 聚合引用的 Unit。
当前入口限制 1 MiB 和 100 个绑定元素，支持多个 Unit。宿主在禁用脚本的 iframe 中挂载
返回 HTML，由独立 renderer 安装交互。模板脚本和内联事件处理器不执行。

语法见 [模板语言](../../docs/design/html-views/template-language.md)。
验证：`pnpm test`、`pnpm typecheck`。
