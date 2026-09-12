# Univer HTML View Renderer

仓库内 private DOM 渲染实现，消费模板解析结果和已加载的 BindingEngine。它负责文本更新、
控件转换、每个单元格共享的 100 ms 滑块节流、编辑草稿和错误显示。不依赖 React 或应用资源
模型，不负责 Unit 加载、协同连接、保存确认或 Engine 释放。

宿主在禁用脚本的 iframe 中装载清理后的 HTML，再调用：

```ts
const mounted = mountHtmlView({ document, template, engines, onError });
// engines: ReadonlyMap<unitId, 已加载的 BindingEngine>
mounted.dispose();
```

挂载是同步操作，失败直接抛错。`dispose()` 只释放 DOM 监听、订阅和计时器，禁用控件；
Engine 始终由宿主管理。`./dom` 的 `mountCellBindings()` 接收元素、Engine 与单元格坐标，
只消费 `getCellState`、`subscribeCell` 和 `setCellValue` 三个方法。

本地写入同步完成，因此无需异步写入队列、重试按钮或错误恢复状态机。失败显示错误并保留
当前草稿，用户可修改后再提交或用 Escape 恢复当前单元格值。

行为见 [模板解析与渲染](../../docs/design/html-views/template-rendering.md)。
验证：`pnpm test`、`pnpm typecheck`。
