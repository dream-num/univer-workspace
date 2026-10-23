# @univerjs/univer-workspace-client-core

`@univerjs/univer-workspace-client-core` 是本仓库内部、供 Node-hosted Workspace Agent Client
复用的 Workspace 客户端能力。它是 private workspace package，不发布 npm package，也不供 Browser
直接消费。

## 职责

- 提供 Workspace HTTP transport、错误和 result-unknown 语义。
- 提供 storage-neutral 的 password login、browser approval、`whoami` 和 remote logout 协议。
- 提供 Space/Node 模型、严格响应解析和远程 workflow。
- 提供仓库引用解析（`owner/slug`、`owner/personal`、Space ID、Browser URL）与 `#N` 编号参数解析；
  服务端不支持时返回 `workspace-server-capability-missing`。
- 提供 Worktree lifecycle、Worktree Unit membership 与 review URL workflow。
- 提供 Blob/Asset 协议、bounded recovery，以及同进程 local Node filesystem 的原子文件传输。
- 提供 runtime target、Worktree/Trunk source resolution、Snapshot read adapter 与 referenced-Unit policy。
- 提供 Shell-neutral worker composition、content runtime pool、同步读取、UnitData export、Facade execution、
  embedded-image externalization 与 changeset commit workflow。SDK 1.1.0 的 headless factory 为五类 Unit
  注册评论 model，已有评论 anchor 在 replay 与 export 中保留；`test/comment-anchors.test.ts` 守住这一上游合同。
- 提供 Node-hosted Office import/export、格式与 Unit 类型校验、Worktree Unit/runtime 集成和默认 exchange adapter。
  导出通过当前 Worktree 的已认证 Asset 读取解析图片 ID，仅在导出副本中恢复内嵌图片；
  缺失、无权限或无效图片使导出失败，不静默丢图，也不写回 Unit 或产生新 revision。
- 提供 Typst bundle 编译、确定性 Doc materialization，以及可选的 Worktree Unit apply workflow。
- 提供 render Unit 装配、browser screenshot capture、PNG 输出、PDF 打印、Slide and Board layout lint，以及配套 render page 构建源。
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

## Board 布局验证

Board lint 直接组合公开 CLI SDK 的 model/rendered 检查合同，不在本 package 维护几何规则。
`mode: "model"` 使用标准 headless factory，不启动浏览器；默认 `both` 保留两阶段原始分析和
incomplete coverage。rendered 检查使用同版本 render page，只有完整覆盖才能报告 clean。

`pnpm --filter @univerjs/univer-workspace-client-core test:board-profiles --out <new-directory>`
运行 15 个 profile 的 45 个确定性变体，覆盖长中英文文字、尺寸与分支变化、真实 native ownership、
plan 只读与确定性、固定元素、应用前后语义、单次 Undo/Redo 和 stale/incomplete 拒绝。
它通过已安装 SDK 的公开 Facade 创建新内存 Board，不连接远程服务。可用 `--profile <name>` 只测
一个 profile；`--fixtures-only` 仅验证 fixture/analysis，不声称覆盖 plan/apply。输出保留原始 model
诊断和快照。增加 `--render --render-page-root <built-render-page>` 会复用一个 browser runtime，
为全部 15 类基础变体和 6 类长文本变体保存截图与原始 rendered 诊断，并为长文本保留可读细节图。
使用 `--render-all` 会为全部 45 个压力变体执行真实 render，保留相同的固定元素和手工路径约束。
同时增加 `--plan-labels` 会通过真实 renderer 获取计划，再在源 headless Board 中验证 apply、
Undo/Redo、stale 拒绝、语义和节点几何保持，以及重新检查后的标签碰撞数。
输出的 `assertions: "passed"` 仅表示合同与保留约束断言通过，不表示图的质量通过；
`labelPlan.status: "ready"` 仅表示该标签计划可应用，不表示整图 clean。截图和原始诊断中的
findings/incomplete 如实保留，修复后仍须读取完整诊断；该脚本不代替实际拖拽交互验证。

默认 `--suite contract` 保留上述固定元素与手工路径压力场景。独立的 `--suite quality`
运行同样 15 类的全部 45 个变体，并自动开启真实 render 和 label plan；仍须提供 `--out`
与 `--render-page-root`。普通节点可移动，反馈关系使用自动正交路由，保留全部关系和标签，
以及真实的 container/lane、sequence、mind map/tree/timeline 所有权。嵌套 frame 有合法容纳空间，
class 使用 `layerGap: 160`；节点尺寸不为消除诊断而预先放大。每个质量场景要求 model/rendered
诊断均 clean。flowchart、dataflow、architecture、deployment 的 fan-out 变体还保留原有边，
增加明确标注的汇聚边，同时验证普通 source/sink 的 fan-out+fan-in；专属语义图不强加 Join 关系。
原始报告、关系/标签数量、截图与残余规则完整输出，不能用合同断言替代该预期。
脚本先完成所有场景，再在质量未达预期时退出 2；合同断言失败退出 1。两类证据应写到独立新目录，
不覆盖已有压力场景或把 native/manual findings 从原始报告中过滤掉。
