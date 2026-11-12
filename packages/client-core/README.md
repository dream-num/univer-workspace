# @univerjs/univer-workspace-client-core

`@univerjs/univer-workspace-client-core` 是本仓库内部、供 Node-hosted Workspace Agent Client
复用的 Workspace 客户端能力。它是 private workspace package，不发布 npm package，也不供 Browser
直接消费。

## 职责

- 提供 Workspace HTTP transport、错误和 result-unknown 语义。
- 提供 storage-neutral 的 password login、browser approval、`whoami` 和 remote logout 协议。
- 提供 Space/Node 模型、严格响应解析和远程 workflow。
- 提供仓库引用解析（`owner/slug`、`owner/personal`、可列出仓库中唯一匹配的裸 slug、Space ID、Browser URL）与 `#N` 编号参数解析；
  服务端不支持时返回 `workspace-server-capability-missing`。
- 提供 Worktree lifecycle、Worktree Unit membership 与 review URL workflow。
- 提供 Blob/Asset 协议、bounded recovery，以及同进程 local Node filesystem 的原子文件传输。
- 提供 runtime target、Worktree/Trunk source resolution、Snapshot read adapter 与 referenced-Unit policy。
- 提供 Shell-neutral worker composition、content runtime pool、同步读取、UnitData export、Facade execution、
  embedded-image externalization 与 changeset commit workflow。当前 headless factory 为五类 Unit
  注册评论 model，已有评论 anchor 在 replay 与 export 中保留；`test/comment-anchors.test.ts` 守住这一上游合同。
  多用户宿主可为每次调用传入 `caller`。只有 `caller.userId` 进入 runtime key；可选 `caller.grant` 为不透明值，
  Client Core 不读取、不序列化它，并将原 caller 传给 `resolveCredential` 与 `resolveLicense`。resolver 只在创建或重建
  worker 时调用，热 worker 保留创建时的凭据与 license。不同 userId 不共享 worker 或凭据。
  可选 `reuseWorker(created, current)` 在命中 init 缓存时检查创建 caller 与当前 caller；返回 false 时，在同一 key
  的串行操作内使旧 worker 失效，再用当前 caller 重新解析凭据。未设置时保留原来的复用行为。
  三个 runtime operation 可传入 `signal`；等待容量或同 key 前序操作时取消会立即返回
  `workspace-runtime-not-started`（`retryable: true, started: false`），之后不会取得 lease 或执行代码。
  取得 lease 后继续执行到结束。`getWorkspaceRuntimeFailurePhase(error)` 区分 script 与 commit 边界，
  保留原 Error 对象、message、name 和 code，让宿主决定展示方式；CLI 的错误展示不变。
  可选 `transportOrigin` 是不含路径、查询、片段或凭据的 HTTP(S) origin。worker HTTP、协同 WebSocket 和提交时的
  内嵌图片上传通过它连接 Workspace；target、runtime key、HTTP adapter URL 与用户可见 URL 保留公共 identity origin，
  HTTP origin 校验和写请求的 Origin header 也保留 identity origin。缺省时 worker init 仍只有 `credential`、`license`、`target`。
  `executeAndCommit`、`executeRead` 和 `exportUnitData` 可逐次传入 `observe({ coldStart, workerMs })`。
  每个取得 lease 的调用在 release 或 invalidate 完成后回调一次，操作或清理失败也回调；未取得 lease 的调用不回调。
  `coldStart` 表示本次调用未命中 init 缓存并创建 worker；`workerMs` 是从取得 lease 到清理结束的单调时钟毫秒数，
  不包含排队、凭据解析与 worker 启动耗时，也不表示 CPU 时间。observer 抛错不改变操作结果。
  可选 `pool` 选项设定 worker 上限、空闲 TTL、超时与子进程环境（`env` 为精确环境，缺省继承）。未传入时行为与 CLI 一致。
  `pool.queue.timeoutMs`（须同时设定 `maxWorkers`）让新 runtime key 在 worker 满时按 FIFO 等待空位，超时以
  `workspace-runtime-busy`（`detail.retryable: true`）失败；该时限只约束等待空位，不约束操作本身。缺省时 worker
  满立即报 `COLLABORATION_POOL_CAPACITY_EXCEEDED`。
  `timeoutMs` 为 0 到 2147483647 的整数，`maxWorkers` 为正整数；排队宿主 `close()` 之后，等待中和之后到达的操作
  都以不可重试的 `workspace-runtime-closed` 失败。加入已持有或正在等待空位的 key 的操作共用该空位（一个 key 永不占第二个 worker），因此
  持续繁忙的 key 可能让其他 key 一直等到各自时限。这是有意的取舍。
- 提供 Node-hosted Office import/export、格式与 Unit 类型校验、Worktree Unit/runtime 集成和默认 exchange adapter。
  导出通过当前 Worktree 的已认证 Asset 读取解析图片 ID，仅在导出副本中恢复内嵌图片；
  缺失、无权限或无效图片使导出失败，不静默丢图，也不写回 Unit 或产生新 revision。
  除文件路径方法外，`importBuffer`/`exportBuffer` 直接收发字节，与路径方法共享同一套校验与创建逻辑。
  `licenseMode` 默认 `"process"`（进程内配置一次，CLI 行为不变）；`"per-operation"` 从不调用
  `configureExchange`，每次导出随选项携带 license 与 licenseKey，供单进程服务多个调用方；导入不需要 license。
  一个 feature 实例只持有一组 license；服务多个 license 的宿主为每个 license 构造一个实例。
  两项均为空表示免费版；只给其中一项在构造时以 `workspace-exchange-license-incomplete` 拒绝。
- 提供 source-neutral 的 HTML View 校验、发布、内联读取和条件替换（`WorkspaceHtmlViewFeature`，输入 `{bytes, name}`），复用 trunk Sheet 导出与 Blob 上传；CLI 自己处理文件路径和恢复信息。读取返回强 ETag 并限制内联结果大小；替换先校验，再复用 Blob 的 ETag 与幂等协议，返回与创建相同的可见性摘要。MCP 使用新增的 `draft` 方法复用校验并向服务端保存草稿，`onWrite` 在全部读取完成后、草稿 POST 前触发；CLI 的 `create` 和 `replace` 继续直接发布。HTTP-only `readWorkspaceHtmlView`、`readWorkspaceHtmlViewDraft` 和 `htmlViewDraftUrl` 从 `/product` 导出，供 gateway 使用。
- 提供 Markdown 到原生 Modern Doc 的共享编译适配、资源边界校验、创建和按稳定 ID 的局部更新；沿用 SDK 默认排版。
- 通过共享 SDK 只读程序把当前原生选中块反转换为 Markdown 和资源文件，返回同次 runtime 读取的 revision 与刷新后的 source map，支持编辑后安全局部更新。
- 提供 Typst bundle 编译、确定性 Doc materialization，以及可选的 Worktree Unit apply workflow。
- Markdown、SVG、Typst bundle 与 Blob 的上传/替换除文件路径外也接受内存输入（`markdown`/`svg` 字符串加
  `WorkspaceSourceFiles` 资源表、`bundle` 文件表、`bytes` 加 `fileName`）。内存输入与路径输入共用读取之后的全部
  步骤；文件表的键必须是不含空段、`.`、`..`、反斜杠的相对 POSIX 路径，入口处校验一次。zip 解包由调用方负责，
  Typst 内存 bundle 在私有临时目录中编译并总是清理，且不支持 `previewDir`。
  入口还拒绝在大小写或 Unicode 规范化（NFC）折叠后相同的键，以及互为文件与目录前缀的键。内存资源查找区分大小写，
  且不做 Unicode 规范化；Blob `fileName` 会去除首尾空白并拒绝 `.`、`..`，调用方的 `bytes` 在入口被复制。
- 提供 render Unit 装配、browser screenshot capture、PNG 输出、PDF 打印、Slide layout lint，以及配套 render page 构建源。
- 提供本机 SVG/relative asset 编译、真实或估算字体测量、Slide page 包装与 Worktree apply workflow。
- 通过独立 worker subpath 交付共享 worker implementation；Client Shell 显式提供 packaged worker entry、
  credential 与 license resolver。
- 通过 package 根入口提供 named exports；另提供轻量子入口 `@univerjs/univer-workspace-client-core/product`，
  只导出 HTTP 型产品 workflow（认证、Space、Issue、Worktree、仓库引用解析），不加载 Univer runtime。
  CLI 的 product 命令（auth/repo/issue/label/pr/search/browse）使用它以保持快速启动。

## 非职责

- 不读取 CLI 配置、Session 文件或 credential storage。
- 不拥有 Commander 命令、输出、Session、daemon socket/control、process signal 或 packaged worker entry 选择。
- 不拥有 browser binary install/probe/resolve 或 CLI render-page artifact copy。
- 不提供 Browser entry、认证凭据持久化或交互、发布流程或跨仓库 SDK 合同。
- 不适配 Browser、sandbox、E2B 或其他 remote filesystem path。

Node-hosted Client Shell 必须注入 Workspace origin、协议调用所需凭据或已认证 HTTP capability。
`apps/cli` 当前是第一个 consumer。CLI 注入 authenticated HTTP 与 configured origin，并继续负责
Commander、Session/config、输出与打开或打印 review URL 的交互。

`./markdown` 与 `./document-materialize` 是供 Node-hosted clients 使用的窄入口。它们只向 consumer
暴露 source、diagnostic、source map 与 UnitData 等 JSON 合同；headless runtime 的 Facade/DI 类型
留在 materialization implementation 内，以保持 Workspace Browser 与 DSH 的 React/Redi 图隔离。
