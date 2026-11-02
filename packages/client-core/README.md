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
新建活动图的责任泳道与流程方向一致，已声明的重试关系通过 `feedbackConnectorIds` 参与布局，
不推进主流程层级；已有文档的泳道方向和手工路径保持原有约束。
层间距使用 SDK 默认标签预算；节点尺寸不为消除诊断而预先放大。每个质量场景要求 model/rendered
诊断均 clean。flowchart、dataflow、architecture、deployment 的 fan-out 变体还保留原有边，
增加明确标注的汇聚边，同时验证普通 source/sink 的 fan-out+fan-in；专属语义图不强加 Join 关系。
原始报告、关系/标签数量、截图与残余规则完整输出，不能用合同断言替代该预期。
质量场景与业务视觉场景由 factory 显式列出普通 preset Shape 的生成 ID，通过公开 rendered lint 的
`textPlanElementIds` 获取原生只读尺寸计划，并经 `applyLayoutPlan` 应用。普通 Shape 不再按高度比例猜测尺寸；

两个生成 factory 对新建普通图形显式提供 `textPlanMaximumWidthGrowth: 1.25`，将横向增长限制传给原生文字规划器；字号和完整文字保持不变。调用方可显式选择 1 到 2，其中 1 保留原宽。预算内无法容纳时保留 incomplete，不回退到猜测尺寸。
缺少计划或计划 incomplete 时保留原模型和诊断，不回退猜测。自定义符号、原生结构与固定/受保护成员不进入
这个选择。表格和明确授权的 Sequence 标题框继续使用各自的原生测量。
每条尺寸写入验证精确 Undo/Redo，尺寸变化后重新布局、收紧生成容器并复测；原生计划也验证 stale 拒绝。
质量场景与业务视觉场景复用实测文本扩容和重新布局流程，保留各自的方向、图预算和固定元素约束；
已声明的反馈关系不推进主流程层级。只有 factory 新建并明确授权的泳池和泳道参与容量扩展。
输入尺寸、原始测量、每次调整和精确 Undo/Redo 均保留；原生受管元素及缺少可靠测量的文字仍报告未收敛。
新生成 Sequence 参与者可由 factory 明确授权按真实测量扩大标题框；lifeline 配置、消息次序和内容保持原值。
该授权不覆盖 fixed、locked、不可选或 managed 元素，也不用于加载的原生结构或 activation bar。
脚本先完成所有场景，再在质量未达预期时退出 2；合同断言失败退出 1。两类证据应写到独立新目录，
不覆盖已有压力场景或把 native/manual findings 从原始报告中过滤掉。

`--suite visual` 保留原有两套结构回归，另行运行 15 类真实业务内容的 45 个视觉场景：
`business`、`long-bilingual` 和 `nested-dense`。可用 `--variant <name>` 缩小迭代范围。
业务清单保留领域字段、UML 基数、消息时序、原生结构所有权、泳道和嵌套边界；新增普通容器在布局前后
通过现有 `fitContainerToContent` 收紧，不将手工排好的坐标当作自动布局结果。
显式指定成员的新 scope 关闭自动捕获，逐层校验 group 和 node 的父级，并为子框的外置标题保留 padding，
避免重叠 seed 框颠倒真实所有权或让父边框压住子标题；普通生成框的上方和侧边至少保留 24 Board units，
为圆角边框及原生图形描边保留空间。
Class、Architecture、Deployment、Package 和 Use Case 模板不覆盖 SDK 默认层间距，让 SDK 根据关系标签
预留空间；布局方向、后四类的 `itemGap: 64`、多区域和用例边界的标题通道仍保留。原生 Timeline 使用公开
`setLayout` 保留各变体请求的方向：普通与长双语使用横向结构，密集嵌套使用纵向单侧结构。
组织树的密集变体使用公开的 `mindmap-vertical` 向下布局，普通与长双语使用 `tree-right`，
节点及父子关系保持相同的原生所有权。
新生成的简单 Sequence 按标题框底边建立共同时间原点，首条消息留出 48 单位，消息间距 72 单位，
lifeline 在末条消息后保留 72 单位。它只收紧 factory 创建的初始图；既有消息时间、activation、fragment
和已保存的 lifeline 配置不因此改写。较高的实测标签或自调用需要增加相应间距并重新检查。
生成标题跟随真实结构范围，保留全部时间顺序、文字、字号与原生所有权。
上述是新生成模板的展示选择，不自动改动已导入的固定边界或端点。
Actor 的新生成标题区与符号绘制区分别计算；通过 Shape Facade 的 `getConnectionSites()` 读取实际手臂
连接点，保留 SDK 比例公式和绘制顺序。旧 SDK 的固定数字路径继续兼容，不改写已有自定义 Actor。
生成标题在布局、fit 和文本扩容后对齐实际内容范围，单独验证只改标题及精确 Undo/Redo，避免标题留在旧 seed
位置而浪费总览宽度。已有至少两层 frame 祖先的 UML Package scope 增加顶部标题通道，普通单层包不受影响。
若已安装 renderer 返回 `element-text-overflow` 的公开 `textLayout` 测量，最多三轮按真实内容/可用
textRect 比例扩大可编辑普通 Shape；Table 使用 inclusive 零基 `tableRange` 仅调整实测行列，合并范围内
按原行列比例扩展，不改单元格内容、合并或样式。无 cell range 的完整原生 Table paint 测量只扩大元素框，
保留资源行列和内容；不完整的 range 仍拒绝。每条公开 resize 写入独立验证 Undo/Redo，再通过相同
selection/direction/fixed 约束重新 plan、apply、fit
和测量；不缩字号。固定、locked、不可选和 native/managed 元素保持不变。新的图计划 incomplete
时回滚该轮尺寸变更并保存诊断。新生成泳池在首次布局及实测子节点扩容后，读取同一公开 graph plan 的
候选位置，为实际全局 rank、字体和关系标签跨度预留泳池主轴与泳道容量；不复制 SDK 的间距估算。新生成泳道的初始截面按最大子节点预留，不累计沿流程排列的节点高度；并行节点所需容量仍由公开 graph plan 扩展，显式 lane 尺寸保持原值。仅
factory 明确标记可扩容的 pool/lane 允许写入，额外保留 24 Board units 的生成留白；pool 的主轴使用
`setElementTransform`，泳道按末尾优先调用 `setSwimlaneLaneSize`，不借用后续显式或受保护泳道的容量。
固定/locked/managed 成员、手工 guides、嵌套或变换 owner、显式 lane 尺寸及无生成授权的已导入 Board
保持不变。每条容量写入验证精确 Undo/Redo；仍 incomplete 时反向回滚并保留原诊断，不应用候选位置。
停止边界不代表必然收敛，未报告 overflow 也不代表人工视觉验收通过。
Component、Architecture、State 和 Dataflow 的三种变体还须逐标签审查与所属路径的距离。验收应保留
完整标签清单、自动/固定 placement、实际旋转文本框、所属路径、Board units 下的距离及对应的 100% 截图；
作者固定标签保持原位。Renderer 提供 `connectorLabelLayouts` 时，每张截图的 `connectorLabelEvidence`
保留原生 rect、旋转、bounds、当前换行宽度下含 padding 的 outer/required 尺寸、独立的 empty/overflow/
endpointConstrained 标志与原始 routes；empty 标签的原生框仍可能有可见绘制，不跳过其度量。
`distanceToResolvedPolyline` 通过逆旋转计算所属 `routes.points` 有限折线与原生矩形的最小距离，单位为
Board units。它不包含描边/marker，也不代表最终圆角或 cubic 路径的距离；issue/focus bounds 和作者
`placement.distance` 都不能代替实际标签框或实测距离。零距离只表示矩形与折线相交，不自动判定视觉好坏。
字段缺失、标签未解析、无充分且唯一的已解析路径，或 map 与可见 route ID 不一致均保留 incomplete。
原生 map 按 SDK 合同枚举可见连接线的全部标签；当前公开 screenshot 结果不携带加载后的同态 native
snapshot，因此独立标签 ID 清单与自动/固定 placement 无法核对，明确记录 unavailable，不使用生成前输入
冒充。`labelProximity.status` 的 measured/incomplete 仅描述几何度量，`coverage.geometry` 记录其覆盖；
独立的 `coverage.independentSameStateLabelIds` 明确保持 incomplete，不使已经测得的几何或原诊断永久失败。
上述 12 个 visual 场景的 quality 同时暴露真实几何缺测，原 rendered 诊断状态与 findings 完整保留。
`--suite visual` 对全部 15 类的 45 个变体在 label-plan 应用前后的原生 lint 中显式请求
`maximumAutomaticLabelDistance: 12`。该 opt-in policy 由 SDK 计算；缺少 receipt、度量未解析或超限
均不能判为 clean。`labelRepair.automaticLabelDistance` 独立保留原生 lint 的 receipt、逐标签状态和
距离；它不是截图 analysis 的测量，未证明与 PNG 为同一 renderer 状态，明确记录
`sameStateWithScreenshots: "not-established"`。截图中原有 `distanceToResolvedPolyline` 保留其 legacy
有限折线限定，不替代 native sampled-stroke metric，`finalPaintDistance` 仍为 unmeasured，人工审阅 pending。
contract、quality 和 elements suite 不默认请求这个 visual policy。
Collision 数量非增、度量完成或诊断 clean 都不代表这项视觉验收通过，不把未测或跳过记为通过。
`--suite elements` 另建元素目录，覆盖已安装 SDK 的全部注册内建/custom/sequence 形状、图表、
8 类图示表格、文字、图片、Ink、连接线标记与容器。目录使用固定展示坐标，只验证可用性与视觉表现；
另外以真实本地 Sheet 验证 native BoardFloating Embed 和 constant/cross-Unit 公式 Shape，通过公开
`embeddedUnits` / `formulaReferenceUnits` 传递源数据。保存、descriptor 或绑定创建成功不代表子文档
像素、公式结果或交互已经通过；预期源值与实际截图/交互审阅分别记录。图表文字和缺少原生 cell 测量的
表格仍须检查其原生本体 bounds 和完整分块截图；cell 测量也不能替代字形 ink 的逐图审阅。
未注册的 Media、模板 Placeholder、legacy Group 和 Diagram adapter slot 分别列出，不冒称已渲染。
SmartArt 使用公开 `insertShape` 创建真实复合 payload，验证逻辑节点、原生子形状和保存历史；当前 Board
绘制复合几何但不绘制子节点文字，目录明确标为 partial，不将保留的文字数据视为完整文字渲染或子节点编辑。
图表目录使用声明源表头的 Column、Bar、Line、Area、Pie、Donut、Scatter 七类原生样例，保留完整源数据；
其他公开图表枚举明确列为未验证，不从枚举注册推断真实渲染可用性。Scatter 使用数值 X 字段，Pie/Donut 显式选择单个值字段。

两套新场景均保存每个 case 的完整 fit 图，以及覆盖整个公开 content extent 的 50%、100%、200%
重叠分块图和原始 rendered 分析。输出记录真正 apply 的结果与 Undo/Redo/stale 断言，不从非空
patch 数量推断应用次数。中途失败保留已生成图片、进度和错误；已有证据目录不覆盖。
每张显式比例图片必须由 renderer 回读确认实际 scale 与请求一致；不一致即停止并保留该次图片及实际比例。
`visualReview.status` 默认为 `pending`：诊断 clean 不能替代逐图审查文字溢出与字号、内容层次、
阅读方向、容器留白、标题/角标/边框、箭头和路径间距。公共 content bounds 也不等于完整字形 ink
测量；需要单独记录实际浏览器字形检查和人工/代理视觉审阅。视觉审阅结果与自动质量结论分开保存。

业务截图的完整内容 overview 显式请求 32 Board units 留白，避免边缘描边贴住裁剪边界。分块仍覆盖 renderer 回读的完整范围，并验证实际缩放比例。
