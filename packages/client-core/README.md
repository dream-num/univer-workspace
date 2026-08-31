# @univerjs/univer-workspace-client-core

`@univerjs/univer-workspace-client-core` 是本仓库内部、供 Node-hosted Workspace Agent Client
复用的 Workspace 客户端能力。它是 private workspace package，不发布 npm package，也不供 Browser
直接消费。

## 职责

- 提供 Workspace HTTP transport、错误和 result-unknown 语义。
- 提供 storage-neutral 的 password login、browser approval、`whoami` 和 remote logout 协议；browser
  approval start/complete、`whoami` 与 logout 接受可选 `AbortSignal` 并透传到各自唯一的 HTTP 请求。
- 提供 Space/Node 模型、严格响应解析和远程 workflow；Space list/browse/find 与 Node
  create/rename/move/Trash methods 接受可选 `AbortSignal`，并把 signal 贯穿 authenticated HTTP
  resolver、分页/递归遍历、mutation 与 read-back。
- 提供 Worktree lifecycle、Worktree Unit membership 与 review URL workflow；这些 public methods
  接受向后兼容的 optional `AbortSignal`，贯穿 resolver、HTTP、稳定 identity retry 与 lifecycle
  read-back，取消后的 uncertain write 保持 `workspace-result-unknown`。
- 提供 Blob/Asset 协议、bounded recovery，以及同进程 local Node filesystem 的原子文件传输；Blob
  get/upload/download 与 Asset download 接受向后兼容的 optional `AbortSignal`，贯穿 resolver、HTTP、
  source/signed response stream、临时输出和 publication boundary。取消撞上已 dispatch upload 时保留完整
  public intent 与已知 Upload Session identity；download 在 publication 前取消会清理 temp 并保留原目标。
- 提供 runtime target、Worktree/Trunk source resolution、Snapshot read adapter 与 referenced-Unit policy；
  inspection 与 execution 入口接受向后兼容的 optional `AbortSignal`。
- 提供 Shell-neutral worker composition、content runtime pool、同步读取、UnitData export、Facade execution、
  embedded-image externalization 与 changeset commit workflow。每个 queue、acquire、sync、read/write、upload、
  mutation replacement 和 commit 边界都等待已开始的 frozen runtime operation 后再决定后续步骤；caller 可在
  side effect 前限制 lossless JSON value 的 bytes/depth。已确认 image upload 后取消返回 structured partial
  side effect，无法确认的 in-flight upload 或 commit 保持 result unknown，且 Core 不自动重放 code 或 image。
- 提供 Node-hosted Office import/export、格式与 Unit 类型校验、Worktree Unit/runtime 集成和默认 exchange
  adapter。向后兼容的 optional controls 为 import 增加 signal、actual-source/UnitData bytes 与 depth gate，
  为 export 增加 signal、exact selected revision、UnitData/output gate 与 atomic no-clobber/force publication；
  不传 controls 时继续直接调用原 `importFile`/`exportToFile` path。
- 提供 Typst bundle 单次编译、diagnostic gate、per-invocation VM Doc materialization，以及可选的
  Worktree-local Unit apply workflow。向后兼容的 optional controls 包括 `AbortSignal`、generated
  JavaScript/Client Shell-visible projection/UnitData bytes 与 depth limits，以及 materializer license；不传
  controls 时保持 Workspace CLI 的 compiler result、write order、diagnostics、preview 与 Unit create 行为。
  Core 等待已经开始且不可硬取消的 native compile 和 generated-program execution，在后续可分离边界检查取消，
  并把 signal 传给共享 Unit create。VM 只隔离 exact compiler program 的 invocation-local random intrinsics，
  不是 hostile-code sandbox。SDK 生成的 paragraph/section/list/range opaque IDs 原样保存在 UnitData 中；语义
  确定性只在测试侧排除这些 ID 后比较，不改写 persisted data。
- 提供 render Unit 装配、browser screenshot capture、PNG 输出、Slide layout lint，以及配套 render page 构建源；
  render、capture、lint 与 browser close 接受 optional `AbortSignal`，partial publication 保留 exact confirmed
  prefix 并禁止自动重放，不传 controls 时保持 Workspace CLI 的既有调用合同。
- 提供本机 SVG/relative asset 编译、真实或估算字体测量、Slide page 包装与 Worktree apply workflow。
- 通过独立 worker subpath 交付共享 worker implementation；Client Shell 显式提供 packaged worker entry、
  credential 与 license resolver。
- 通过 package 根入口提供 named exports。

## 非职责

- 不读取 CLI 配置、Session 文件或 credential storage。
- 不拥有 Commander 命令、输出、Session、daemon socket/control、process signal 或 packaged worker entry 选择。
- 不拥有 browser binary install/probe/resolve 或 CLI render-page artifact copy。
- 不提供 Browser entry、认证凭据持久化或交互、发布流程或跨仓库 SDK 合同。
- 不适配 Browser、sandbox、E2B 或其他 remote filesystem path。
- 不拥有 Client Shell 的 Session cwd/local-provider/file-policy、human approval、credential/license storage、
  local artifact layout/publication、packaged worker/native-binding entry，或 Office/Typst tool
  schema、SVG tool schema、render、error projection 与 finalizer。

Node-hosted Client Shell 必须注入 Workspace origin、协议调用所需凭据或已认证 HTTP capability。
`apps/cli` 注入 authenticated HTTP 与 configured origin，并继续负责 Commander、Session/config、输出与
打开或打印 review URL 的交互。`apps/dsh-univer-work` 只通过 package 根入口复用 browser approval、
`whoami`、logout、authenticated HTTP、Space/Node、Worktree/Unit/review、Blob/Asset file workflow、
content source/execution/runtime 与错误语义，并在 Client Shell 内负责 DSH Credentials 持久化、human
approval、tool/Skill schema、secret filtering、Cordis lifecycle、packaged worker entry 和
license/credential resolver。该 Shell 也复用 Core Office owner，把受控 import 限制在 52,428,800 个
actual source/UnitData bytes 与 64 层，按 authoritative Worktree head 导出，并为三种 dispatched create
non-confirmed outcome 保留 inspect-before-retry/no-replay 语义；Client Core 不读取其 credential key、
DSH Session、approval state 或 packaged Skill。对于 Typst，Client Shell 从 package 根入口组合
`WorkspaceCompileTypstFeature`、`HeadlessWorkspaceTypstMaterializer` 与共享 Unit owner，注入 current license、
authenticated Unit capability 和可选 limits；artifact destination、approval、Host-local path policy、installed
native closure 与 no-replay presentation 仍由相应 Client Shell 拥有。

对于 SVG，Client Core 保持单一 compile/measure/apply workflow，并提供可选 signal、canonical local root、
source/aggregate asset 与 apply-value limits。Client Shell 注入 calling Session cwd、local provider/policy、
approval、output publication、current license、package-relative render page 与 browser environment；Core 不读取
DSH Session、credential key 或 approval state，也不注册工具或拥有另一套 browser/runtime owner。

对于 render，Client Shell 负责 browser 选择、package-relative render page、Session cwd、Host-local file
policy、human approval、result budget 与 deployment isolation。DSH Shell 只把 screenshot 发布到已批准目录，
使用 `0600`、no-overwrite PNG；layout lint 只读 Worktree Slide，PNG bytes 不进入 tool result。Client Core
等待已开始的 browser/native work 和 browser close，但不提供 OS/process sandbox。使用 Chromium
`--no-sandbox` 的 Host 必须部署在受限 OS user/container 中，并限制 filesystem 与 network；浏览器版本和
系统字体仍可能改变像素与测量。Browser 安装/cache、shared pool、attachment capture、Trunk lint、新 lint
规则和非 PNG 输出仍由其他 owner 或后续 change 决定。
