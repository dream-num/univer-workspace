# Agent 与 DSH 的浏览器传输边界

[English](agent-transport-boundary.md) | 简体中文

状态：边界与迁移方案已确定，替换尚未实现。当前消费的 DSH `0.1.5-rc.1`
缺少下述 WebSocket、资源 URL 扩展点，需要上游发布支持后再接入。
本文是待实施的集成方案，不是已交付 API 或 ADR。

## 职责

| 所有者 | 负责 | 不负责 |
| --- | --- | --- |
| DSH | 浏览器认证、RPC、Remote mux、上传载体和回执、Session 附件归属、连接重试；提供通用传输扩展点 | Workspace 账号、Space、连接版本及切换策略 |
| Agent core | Workspace OAuth、账号运行目录与服务生命周期、页面连接版本、服务端隔离校验、切换后的页面恢复；装配传输策略 | 实现 DSH mux 协议、上传 Worker、附件回执或重连循环 |
| Workspace 能力插件 | 显式使用 Agent 的传输策略请求产品 API；通过 Univer SDK 公开 HTTP/URL 配置接入协同与资源访问 | 改写浏览器全局对象、复制 SDK 传输实现、决定当前账号 |
| Workspace Server | 远程身份、产品权限和文档操作的权威校验 | DSH 本地浏览器或 Session 附件的生命周期 |

页面连接版本属于 Agent 的账号隔离策略。它在页面创建时固定，普通网络重连不更换它。
DSH 的 connection generation 属于传输生命周期，断线重连也会变化，不能代替页面连接版本。
连接版本不是登录凭据；DSH 浏览器认证和 Workspace 服务端权限检查始终保留。

## 当前实现与缺口

[connection-browser.ts](../../apps/agent/src/connection-browser.ts) 在页面启动前改写全局
`fetch`、`WebSocket` 和 `HTMLAnchorElement.prototype.click`。这只是过渡适配，依赖请求路径、
启动顺序和 DSH 的下载实现，不能作为长期合同。新增上传修复使用公开 hook，但没有消除这些依赖。

核对依据是已发布的 `@deepseek-ai/*@0.1.5-rc.1` 包 README、公开声明与运行代码：

| 通道 | 已发布能力 | 迁移路径 |
| --- | --- | --- |
| DSH RPC | `dsh-client-connection/client` 导出的 `ClientTransportHooks.fetch`，启动前由 `__DSH_TRANSPORT__` 配置 | 注入带页面连接版本的 Fetch 载体 |
| DSH 附件 | `dsh-client-file-upload` 的 `__DSH_FILE_UPLOAD__.fetch` | 注入相同策略的载体，保留 Session 回执、取消和流语义 |
| DSH Remote mux | Gateway 内部直接 `new WebSocket(remoteStreamUrl())`；公开 mux 声明未提供 URL 配置 | 上游增加建立物理连接前的 URL 扩展点 |
| DSH 下载及浏览器直接请求的资源 | 现有适配拦截下载 anchor 的 `click`，不是资源 URL 合同 | 上游增加生成资源 URL 时的扩展点，覆盖下载和直接媒体引用 |
| Workspace HTTP、协同与资源 | 请求和 Viewer 端点装配在能力插件内，部分仍依赖被替换的全局 Fetch | 显式注入 Agent 策略，使用 SDK 公开 HTTP/端点扩展，不把这部分交给 DSH |

`ClientTransportHooks.openStream` 是提供另一种逻辑流载体的接口，不是给现有 WebSocket 加参数的接口。
不能为了使用它在 Agent 内重写 DSH mux。也不能用共享 cookie 存页面版本：切换账号会同时改变
旧标签页发送的 cookie，失去识别旧页面的能力。

## 上游接口交付要求

建议在既有 `ClientTransportHooks` 中增加以下两个可选字段；名称是待上游确认的提案，
不能在当前版本上直接引用或通过类型断言假装它们已经存在：

```ts
resolveWebSocketUrl?(url: URL): URL;
resolveResourceUrl?(url: URL): URL;
```

- Hook 在 DSH 启动前装配；未配置时保持当前原生行为。保留现有 Fetch、流载体及模块加载配置。
- Gateway 每次建立物理 WebSocket，包括重连时，调用 URL hook，然后继续由 DSH 创建 socket、
  管理心跳、多路复用、取消和重试。Agent 不接管这些职责。
- 下载和直接媒体引用在产生浏览器将使用的 URL 时调用资源 hook。下载的 HEAD 校验与最终 GET
  都必须使用同一页面版本；不能只装饰按钮事件，也不能漏掉脱离 DOM 的 anchor。
- 上游不包含 `x-uwh-connection`、`uwhConnection`、Workspace 路由或账号知识。
  URL 是否需要附加标识由消费方判断；外域、静态资源、`blob:` 和 `data:` 地址保持原样。
- Hook 不得通过替换全局 Fetch、WebSocket 或 DOM 原型实现；未配置和配置后的行为都由上游测试覆盖。
- 现有连接状态订阅必须覆盖首次连接失败、连接丢失和重试。Agent 用它触发自己的就绪检查，
  不监听被替换的 WebSocket 构造函数，也不新增物理连接重试循环。

接口由 DSH 仓库实现并发布。本仓库只消费公开 package exports，不 fork DSH，
不 patch 已安装包，不依赖相邻 checkout。此文可直接作为上游接口实现与验收的交接依据。

## Agent 接入与删除顺序

1. 上游发布上述接口和行为测试后，更新本仓库消费版本及 lockfile。
2. Agent core 用正常 TypeScript 实现页面固定的传输策略，编译为启动前脚本：HTTP 增加
   `x-uwh-connection`，受保护的 WebSocket/资源 URL 增加 `uwhConnection`。
   捕获原生载体并通过公开 hook 显式注入，不修改全局对象。绑定的版本不能在恢复时刷新成新账号版本。
3. 能力插件通过 Agent 装配的有类型的服务获取该策略，替换自身直接 Fetch 调用及 SDK HTTP/URL
   装配；遵循现有 Cordis 跨包服务边界，不增加 package 对 application 的源码依赖。
   清点所有受保护入口，包括 Blob/Asset、导入导出、协同 HTTP 与 WebSocket。
4. 用 DSH 连接状态订阅、明确的隔离拒绝响应及 `pageshow` 触发 Agent 就绪检查。
   普通业务 409 不等同于账号切换；状态端点确认版本已变且新运行时就绪后才重载。
   不自动重放上传或写请求，不通过更新旧页面标识继续操作新账号。
5. 保留 [RuntimeWebServer](../../apps/agent/src/runtime-webserver.ts) 的服务端版本检查。
   全部通道迁移且下列验证通过后，删除 `connection-browser.ts` 的全局拦截与字符串脚本。

不能在仅迁移 RPC 或上传后宣称全局拦截已被替代；也不能为先删掉适配而允许无版本请求通过。

## 完成条件

- 在未修改浏览器 `fetch`、`WebSocket`、anchor 原型的真实应用中验证 RPC、附件、日志下载、
  直接媒体引用、Workspace 文件与协同；同时验证 Web 和 Desktop 的启动前装配顺序。
- 两个旧标签页同时停留在账号 A，另一页切到 B：旧请求和旧 socket 重连被拒绝；就绪后重载，
  不重放旧上传/写入。切换到不同 Workspace origin 的同名用户也满足该条件。
- 同账号普通断线由 DSH 重连；页面恢复、切换期间 503、旧页面 409 均按既有边界处理，空闲不轮询。
- 附件保持二进制/流内容、取消、进度语义和所属 Session；其他 Session 不能消费该回执。
- 下载 HEAD 与 GET 保持同一版本，外域和静态资源不携带版本；服务端认证和 ACL 没有弱化。
- 运行类型检查、相关回归、实际 package/浏览器验证及仓库 CI；在 PR 记录所消费的上游版本与证据。

在这些条件完成前，附件功能测试通过不等于传输边界整改完成，不能据此给出无条件合入结论。
