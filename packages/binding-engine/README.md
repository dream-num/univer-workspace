# Univer Binding Engine

仓库内 private 单元格绑定实现，供 HTML Renderer 等内部消费者使用。一个 Engine 拥有一个
独立 Headless Univer 和一个主 Sheet Unit，提供加载、按坐标读写、订阅与释放。
它不拥有 HTML、DOM、React、Workspace Resource、身份或来源授权，也不发布公共 SDK。

```ts
const engine = new BindingEngine({
  unitId,
  collaborationClientConfig, // SDK IUniverCollaborationClientConfig，包含 socketService
  // createUniver: createWorkspaceBindingUniver, // 可选同步工厂
});
await engine.load();
const cell = { sheetId, row: 6, col: 1 };
const subscription = engine.subscribeCell(cell, (state) => consume(state));
engine.setCellValue(cell, 20);
await engine.flush();
subscription.dispose();
engine.dispose();
```

默认 `createDefaultBindingUniver` 装配 Headless Sheet、Pro 公式、网络和协同插件，不读取应用
配置。自定义工厂接收相同协同配置，返回 SDK 原有 `{ univer, univerAPI }`，独立实例的所有权
交给 Engine。许可证、当前身份和跨 Unit 来源策略由自定义工厂配置。

`load()` 复用同一个 Promise；订阅立即通知当前状态，之后仅通知变化。固定坐标读写使用 SDK
标量和权限语义。`setCellValue()` 通过 Facade 对象格式同步写入，检查参数和权限并传播 SDK 异常，
不额外检查底层命令的布尔返回值。状态使用 SDK `CollaborationStatus`，`flush()` 等待协同确认。
不自动重试。`dispose()` 幂等且不隐式保存。

完整接口与生命周期见 [Binding 引擎](../../docs/design/html-views/binding-engine.md)。
验证：`pnpm typecheck`、`pnpm test`。浏览器网络与认证由宿主接入；Node 宿主需提供相应 SDK socketService。
