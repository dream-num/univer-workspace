# Browser 集成

[返回集成概览](README.md)

## 构建与打开文件

[Blob 预览入口](../../../apps/workspace/web/src/features/blobs/blob-preview.tsx) 使用 SDK 的
`isHtmlViewFilename()` 将 `.univer.html` 交给 `HtmlViewFile`。
侧栏 Apps 跟在团队空间后面，通过 `GET /api/html-views` 列出当前用户能打开的这类 Blob。
主区域使用和 Node 页相同的 HTML 视图与顶栏操作；沉浸视图仍进入
`/nodes/{nodeId}?view=immersive`。
`HtmlViewFile` 携带当前会话读取 `contentUrl`，`HtmlView` 组合私有共享组件
`@univerjs/univer-workspace-html-viewer`，由 SDK 的 `renderHtmlView()` 解析并渲染 HTML。
读取或解析失败直接展示错误。解析器同时识别文本、控件、单元格订阅和范围订阅四种声明。
页面通过 `data-univer-cell-subscribe` / `data-univer-range-subscribe` 声明自定义组件来源，
用原生 HTML ID 调用 `subscribeCellById()` / `subscribeRangeById()`。SDK 管理声明的订阅、
引用切换与释放，Workspace 不提供旧版页面订阅 API 的兼容层。

## 页面与宿主连接

[Web 适配组件](../../../apps/workspace/web/src/features/html-views/html-view.tsx) 在取得会话身份（含匿名访客）后，
挂载[共享页面组件](../../../packages/workspace-html-viewer/src/viewer.tsx)。共享组件给 SDK
`renderHtmlView({ container, html, locale, loadEngine, policy, onError })` 提供一个 div。
SDK 自身包含 iframe 程序，管理 iframe sandbox、CSP、握手与 MessagePort、订阅和释放。
应用不再注入 runtime 或注册 renderer Vite 插件。原生表单导航由 SDK 的
`form-action 'none'` 阻止；HTML 文件无需携带 SDK 或协同凭据。

“检查绑定”位于 HTML 文件工具栏的下载按钮左侧，viewer 同样可见。
按钮通过 portal 放到工具栏，状态和操作仍归 HTML 预览器。
进入沉浸视图时隐藏功能区并关闭 inspect，退出后不自动重新打开，页面实例和输入保留。
“检查绑定”切换 `view.inspect.open()` / `close()`。SDK 提供侧栏、hover
卡片和高亮，默认高亮全部绑定，选择元素使用单独的高亮效果。共享组件从已授权加载的
同一个 Workbook 读取工作簿和子表名称，缺失名称显示 `id: xxx`，不创建额外的 Engine。
语言使用页面创建时的 Workspace `language`；切换语言不销毁正在编辑的页面，重新打开后
应用新的检查界面语言。接口和职责见[共享组件说明](../../../packages/workspace-html-viewer/README.md)。

`HtmlView` 可接收 `allowedOrigins` 并传给 SDK；当前 `HtmlViewFile` 入口允许
`https://cdn.jsdelivr.net`，用于按需加载 ECharts 等前端库。其他外部来源需要宿主显式配置。
身份、授权和协同配置保留在宿主侧。

### 引用 Workspace 中的媒体文件

`<video>`、`<audio>`、`<source>` 与 `<img>` 可以写 `data-workspace-src="<nodeId>"` 引用
同一 Workspace 的视频、音频或图片。`HtmlViewFile` 取得 HTML 后由
[媒体解析](../../../apps/workspace/web/src/features/html-views/workspace-media.ts)以匿名身份
（`credentials: "omit"`）查询每个 Node，只把已开启链接分享、就绪的媒体 Blob 替换为
`<origin>/api/blob-resources/{resourceId}/content`；已有 `src` 的元素与无法解析的引用保持原样，
不发请求。SDK 的 `policy.mediaSources` 只把 `<origin>/api/blob-resources/` 加入 `img-src` 与
`media-src`，脚本、请求、frame 和 worker 仍只允许 `allowedOrigins`，因此页面可以边下边播，
但不能 `fetch` 这些地址或访问其他 Workspace 路由。

私有媒体即使当前读者有权限也不解析。能编辑 HTML 的人可能写入自己无权读取的 Node ID，
若按读者权限解析，内容会被带出沙箱。iframe 是不透明 origin，媒体请求本身也不携带会话 Cookie。

`policy.mediaSources` 由
[dream-num/univer-data-binding-sdk#11](https://github.com/dream-num/univer-data-binding-sdk/pull/11)
提供，自 `@univerjs-labs/html-view-renderer@1.0.0-dev.0529939d` 起可用。

## 来源授权与 Univer 装配

[`createWorkspaceBindingEngine`](../../../apps/workspace/web/src/features/html-views/workspace-binding-engine.ts)
承担应用适配，按以下顺序执行：

1. 通过 `GET /api/unit-resources/{unitId}` 解析来源资源。
2. 通过 `POST /api/resources/{resourceId}/open` 获取当前用户的打开结果。
3. 确认来源为 Sheet、返回的 Unit ID 与请求一致，读取 `editorMode`。
4. 调用共享 `createWorkspaceHtmlEngine`，传入来源权限、用户、license、协同配置和引用 Provider 装配；Browser 显式设置 `enableReadOnlyTrial: true`。
5. 共享工厂等待 `engine.load()`，为只读来源设置 Workbook 只读，再返回 Engine。

`collaborationClientConfig` 接入 Workspace 同源的 `/universer-api` snapshot、changeset、
WebSocket、session ticket 和授权入口。Workspace 的 snapshot override 与 referenced-Unit
provider 均使用 trunk 上下文。

共享包拥有基础 Univer 插件装配、用户与 license 注入以及 Engine 生命周期。
Web 适配保留 snapshot override 和 referenced-Unit provider，并通过 `registerEmbed` 注入；
SDK Engine 接管独立 Univer 的加载与释放。

共享工厂的 `enableReadOnlyTrial` 默认关闭。Agent 等未启用的宿主仍在写入前拒绝匿名访客
（`signInRequired`）和已登录只读用户（`editPermissionRequired`），不把 Facade 的静默拒绝当作成功。
Browser 启用后，只读来源在第一次页面写入前保持实时；第一次写入先释放该来源的协同 Controller
和 Session，再启用本地编辑及插行。原有公式引擎和绑定订阅继续运行，页面不复制公式逻辑。
试算不会保存或发送，来源此后不接收所有者更新，刷新才恢复实时数据。服务端权限校验保持不变。

只有启用试算的只读来源设置 `enableOfflineEditing: false`，避免离线修改进入重放缓存；编辑者和
未启用试算的宿主保留调用方协同配置。工厂返回 `writeMode`：编辑者为 `saved`，启用试算的
只读用户为 `trial`，未启用的只读用户为 `rejected`。这个值表示写入方式，不是保存完成确认。

加载过程使用 Host 提供的 `AbortSignal`。取消或失败时释放已创建的 Engine；成功返回后，
由 Host 管理 Engine，应用不额外缓存或跨页面共享实例。

## 保存与离开

Workspace 通过 `onStatus` 跟踪同步状态，供离开提醒使用；正常页面不显示独立保存或同步提示。
第一次试算写入触发 `onTrialStarted`，Browser 在 iframe 外显示“试算模式，改动不会保存。
刷新页面恢复最新表格。”页面可通过 `await window.univerWorkspace.getWriteMode(unitId)`
查询已加载来源的写入方式，试算文案不得声称“已保存”。脱离协同后状态为 `NOT_COLLAB`，
`flush()` 不提交修改，此状态不作为待保存内容触发离开提醒。
路由的 `useBlocker` 在离开前执行 `await viewer.prepareToLeave()`：成功才允许导航，失败则展示错误并
保留页面。草稿提交和协同确认由 SDK 完成。

关闭或刷新浏览器时，`viewer.hasPendingChanges()` 或任一 Unit 尚未同步会触发离开提醒；
浏览器强制结束不能保证保存完成。共享组件卸载时取消状态订阅并调用 SDK `view.dispose()`。
文件读取同样在组件清理时取消。

## 原生 Office 预览

Workspace Browser 在模板中增加独立的 `window.univerWorkspace` 导航接口，用于在页面预留
位置打开按服务端权限编辑或只读的实时 Sheet / Doc / Slides。原生预览不参与 HTML 本地试算。
它不替代 SDK 的 `window.univerBinding`，不传递
凭据或 Facade。`features/html-views` 拥有模板导航桥与预览布局；`/preview/$unitId` 在独立
浏览上下文中重新鉴权，并复用标准 ResourceEditor。段落、单元格与页面定位由 Editor 的
[预览导航入口](../../../apps/workspace/web/src/features/editor/preview.ts)约束。

参见[页面接口、权限与生命周期](native-preview.md)。Agent Sidecar 当前不提供此接口。

## 独立打开（无 iframe）

工具栏的“独立打开”在新标签页以顶层文档打开 `/apps/{nodeId}/run`。该地址读取原有 Blob，
不复制 App、不改变 Node、Resource 或共享权限。页面自己的 query 与 fragment 直接交给 App；
例如 `/apps/{nodeId}/run?prd=checkout#refundFaq`。刷新及浏览器前进/后退遵循页面自己的路由。
未登录且无匿名读取权限时，可信登录交接页面保留完整入口（包括 fragment），登录后返回。
每次打开重新校验 ACL；取消共享后不能通过旧地址继续获取文件。

这条入口面向不依赖 Workspace 数据绑定的自包含 HTML App，最大 5 MiB。
服务端通过 HTTP CSP `sandbox`（不含 `allow-same-origin`）隔离上传脚本，禁止访问
Workspace cookie、localStorage、API、iframe 与 worker；内联脚本/样式和 jsDelivr
资源可使用。原生表单提交和自定义 base URL 被阻止，外部链接需用户点击。
这些限制同样适用于登录用户；不得将该入口改成以 Workspace 同源权限执行任意上传脚本。

独立页面没有 Binding Host，也没有 `window.univerBinding` / `univerWorkspace` 桥接能力。
包含声明式 Sheet 绑定的页面会提示使用原有内嵌入口；使用这些 JS 桥接 API 的页面也必须继续
使用内嵌视图。嵌入式 SDK 页面及其引擎、检查绑定、授权读取和保存行为保持不变。
独立模式不注入导航消息桥，App 自行实现 hash/query 路由。
