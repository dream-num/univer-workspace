# Browser 集成

[返回集成概览](README.md)

## 构建与打开文件

[Blob 预览入口](../../../apps/workspace/web/src/features/blobs/blob-preview.tsx) 使用 SDK 的
`isHtmlViewFilename()` 将 `.univer.html` 交给 `HtmlViewFile`。
`HtmlViewFile` 携带当前会话读取 `contentUrl`，`HtmlView` 调用 `parseHtmlView(source)`。
读取或解析失败直接展示错误。

[Vite 配置](../../../apps/workspace/vite.config.ts) 注册发布包提供的 `htmlViewRuntime()` 插件，
页面组件从 `virtual:html-view-runtime` 导入运行时代码。Browser 构建负责将运行时交付给页面，
HTML 文件无需携带 SDK 或协同凭据。

## 页面与宿主连接

[页面组件](../../../apps/workspace/web/src/features/html-views/html-view.tsx) 在取得登录用户后，
为本次加载生成 `connectionId`，先安装连接监听，再生成 iframe 内容：

```ts
iframe.srcdoc = createHtmlViewDocument({
  template: parsed,
  runtime,
  connectionId,
  ...(allowedOrigins ? { allowedOrigins } : {}),
});
```

iframe 使用 `sandbox="allow-scripts"` 和 `referrerPolicy="no-referrer"`。
宿主按 SDK 接入合同验证连接来自该 iframe、origin 为 `null`、token 与本次连接一致，
并接收其 MessagePort；重复连接关闭多余端口。

验证通过后，宿主把 Workspace 的来源加载函数接入 SDK：

```ts
host = createBindingHost(event.ports[0], {
  loadEngine: (unitId, signal) => createWorkspaceBindingEngine(unitId, user, signal),
  onError: setError,
  onClose() {
    if (hostRef.current === host) hostRef.current = undefined;
    host = undefined;
  },
  onStatus(states) {
    // 将 SDK 协同状态映射到 Workspace 保存提示和离开提醒。
  },
});
```

`HtmlView` 可接收 `allowedOrigins` 并传给 SDK；当前 `HtmlViewFile` 入口允许
`https://cdn.jsdelivr.net`，用于按需加载 ECharts 等前端库。其他外部来源需要宿主显式配置。
身份、授权和协同配置保留在宿主侧。

## 来源授权与 Univer 装配

[`createWorkspaceBindingEngine`](../../../apps/workspace/web/src/features/html-views/workspace-binding-engine.ts)
承担应用适配，按以下顺序执行：

1. 通过 `GET /api/unit-resources/{unitId}` 解析来源资源。
2. 通过 `POST /api/resources/{resourceId}/open` 获取当前用户的打开结果。
3. 确认来源为 Sheet、返回的 Unit ID 与请求一致，读取 `editorMode`。
4. 创建 Engine，传入 `unitId`、`collaborationClientConfig` 和 Workspace 的 `createUniver` 工厂。
5. 等待 `engine.load()`；只读来源调用 Workbook 的 `setEditable(false)`，再返回 Engine。

`collaborationClientConfig` 接入 Workspace 同源的 `/universer-api` snapshot、changeset、
WebSocket、session ticket 和授权入口。Workspace 的 snapshot override 与 referenced-Unit
provider 均使用 trunk 上下文。

Workspace 使用自定义 `createUniver(config)`，以装配当前用户、license、公式与协同插件、
snapshot override 和 referenced-Unit provider。工厂返回 `{ univer, univerAPI }`，Engine
接管独立 Univer 的加载与释放。完整装配代码以该函数为准。

应用内的 `WorkspaceBindingEngine` 在写入前检查来源的 `editorMode`，只读时直接报错。
这是产品权限适配：仅将 Workbook 设为只读时，底层 Facade 可能不写入但也不抛错，不能据此
向页面报告写入成功。服务端仍负责实际请求的权限校验。

加载过程使用 Host 提供的 `AbortSignal`。取消或失败时释放已创建的 Engine；成功返回后，
由 Host 管理 Engine，应用不额外缓存或跨页面共享实例。

## 保存与离开

Workspace 通过 `onStatus` 展示已保存、同步中、连接中断或冲突。
路由的 `useBlocker` 在离开前执行 `await host.flush()`：成功才允许导航，失败则展示错误并
保留页面。草稿提交和协同确认由 SDK 完成。

关闭或刷新浏览器时，`host.hasPendingChanges()` 或任一 Unit 尚未同步会触发离开提醒；
浏览器强制结束不能保证保存完成。组件卸载时移除连接监听并调用 `host.dispose()`。
文件读取同样在组件清理时取消。
