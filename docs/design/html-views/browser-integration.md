# Browser 集成

[返回集成概览](README.md)

## 构建与打开文件

[Blob 预览入口](../../../apps/workspace/web/src/features/blobs/blob-preview.tsx) 使用 SDK 的
`isHtmlViewFilename()` 将 `.univer.html` 交给 `HtmlViewFile`。
`HtmlViewFile` 携带当前会话读取 `contentUrl`，`HtmlView` 组合私有共享组件
`@univerjs/univer-workspace-html-viewer`，由 SDK 的 `renderHtmlView()` 解析并渲染 HTML。
读取或解析失败直接展示错误。解析器同时识别文本、控件、单元格订阅和范围订阅四种声明。
页面通过 `data-univer-cell-subscribe` / `data-univer-range-subscribe` 声明自定义组件来源，
用原生 HTML ID 调用 `subscribeCellById()` / `subscribeRangeById()`。SDK 管理声明的订阅、
引用切换与释放，Workspace 不提供旧版页面订阅 API 的兼容层。

## 页面与宿主连接

[Web 适配组件](../../../apps/workspace/web/src/features/html-views/html-view.tsx) 在取得登录用户后，
挂载[共享页面组件](../../../packages/workspace-html-viewer/src/viewer.tsx)。共享组件给 SDK
`renderHtmlView({ container, html, locale, loadEngine, policy, onError })` 提供一个 div。
SDK 自身包含 iframe 程序，管理 iframe sandbox、CSP、握手与 MessagePort、订阅和释放。
应用不再注入 runtime 或注册 renderer Vite 插件。原生表单导航由 SDK 的
`form-action 'none'` 阻止；HTML 文件无需携带 SDK 或协同凭据。

页面工具栏的“检查绑定”切换 `view.inspect.open()` / `close()`。SDK 提供侧栏、hover
卡片和高亮，默认高亮全部绑定，选择元素使用单独的高亮效果。共享组件从已授权加载的
同一个 Workbook 读取工作簿和子表名称，缺失名称显示 `id: xxx`，不创建额外的 Engine。
语言使用页面创建时的 Workspace `language`；切换语言不销毁正在编辑的页面，重新打开后
应用新的检查界面语言。接口和职责见[共享组件说明](../../../packages/workspace-html-viewer/README.md)。

`HtmlView` 可接收 `allowedOrigins` 并传给 SDK；当前 `HtmlViewFile` 入口允许
`https://cdn.jsdelivr.net`，用于按需加载 ECharts 等前端库。其他外部来源需要宿主显式配置。
身份、授权和协同配置保留在宿主侧。

## 来源授权与 Univer 装配

[`createWorkspaceBindingEngine`](../../../apps/workspace/web/src/features/html-views/workspace-binding-engine.ts)
承担应用适配，按以下顺序执行：

1. 通过 `GET /api/unit-resources/{unitId}` 解析来源资源。
2. 通过 `POST /api/resources/{resourceId}/open` 获取当前用户的打开结果。
3. 确认来源为 Sheet、返回的 Unit ID 与请求一致，读取 `editorMode`。
4. 调用共享 `createWorkspaceHtmlEngine`，传入来源权限、用户、license、协同配置和引用 Provider 装配。
5. 共享工厂等待 `engine.load()`，为只读来源设置 Workbook 只读，再返回 Engine。

`collaborationClientConfig` 接入 Workspace 同源的 `/universer-api` snapshot、changeset、
WebSocket、session ticket 和授权入口。Workspace 的 snapshot override 与 referenced-Unit
provider 均使用 trunk 上下文。

共享包拥有基础 Univer 插件装配、用户与 license 注入以及 Engine 生命周期。
Web 适配保留 snapshot override 和 referenced-Unit provider，并通过 `registerEmbed` 注入；
SDK Engine 接管独立 Univer 的加载与释放。

共享 `WorkspaceBindingEngine` 在写入前先检查访客身份并提示登录，再检查宿主传入的来源权限；已登录只读用户收到明确权限错误。
这是产品权限适配：仅将 Workbook 设为只读时，底层 Facade 可能不写入但也不抛错，不能据此
向页面报告写入成功。服务端仍负责实际请求的权限校验。

加载过程使用 Host 提供的 `AbortSignal`。取消或失败时释放已创建的 Engine；成功返回后，
由 Host 管理 Engine，应用不额外缓存或跨页面共享实例。

## 保存与离开

Workspace 通过 `onStatus` 跟踪同步状态，供离开提醒使用；正常页面不显示独立保存或同步提示。
路由的 `useBlocker` 在离开前执行 `await viewer.prepareToLeave()`：成功才允许导航，失败则展示错误并
保留页面。草稿提交和协同确认由 SDK 完成。

关闭或刷新浏览器时，`viewer.hasPendingChanges()` 或任一 Unit 尚未同步会触发离开提醒；
浏览器强制结束不能保证保存完成。共享组件卸载时取消状态订阅并调用 SDK `view.dispose()`。
文件读取同样在组件清理时取消。
