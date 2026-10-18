# Repository Dashboard

状态：用户于 2026-10-18 选择 A「GitHub 工作总览」，并批准整体计划与高度还原 GitHub 风格的实施。
实现已完成；Workspace 类型检查、生产构建与全部 437 项测试通过。下方记录已接受的设计与验收范围。
执行范围与任务状态见 [整体计划](../../../../tasks/plan.md) 和 [任务清单](../../../../tasks/todo.md)。

## Direction contract

THESIS：Repository 首页让用户在一屏内定位仓库、继续文件、查看 PR 与 Issues。采用已选的 GitHub Dashboard 信息结构。

OWN-WORLD：OfficeLab 品牌；GitHub 系统字体栈；白色/深色背景、浅层工具栏、1px 中性边框、6px 圆角。
链接蓝、创建按钮绿、PR 真实状态色；正文 14px，辅助信息至少 12px。

STORY：左侧找到仓库；中间继续文件并浏览近期事项；进入完整列表、详情，之后可返回筛选上下文。

FIRST VIEWPORT：全宽工具栏，下方 256px 导航，中央工作区与 260px 辅助栏。新建在仓库导航和目录页头。
完整列表页使用同一导航，主内容展开。手机导航使用抽屉，辅助内容依次下移。

FORM：用户明确选择 A GitHub 工作总览（原型轮次 02088968）；原型展示数据仅为示例。
补全全部仓库、全局 PR/Issues、最近访问与 Pages，并复用已有资源、权限和审阅合同。

FINISH：unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## 实现与验收

- 首页、全部仓库、全局 PR、Issues、最近访问与 Pages 已接通真实服务和现有详情流程。
- 新增回归覆盖目录显示名/简介/所有者搜索、筛选组合、URL 校验、摘要权限、游标过滤、20 页缓存后的首页请求上限、首屏列表之外的 Worktree ID 读取。
- 浏览器实测：目录搜索与刷新恢复、无匹配、公开筛选、新建空名称校验/取消、已处理 PR 与已关闭 Issues、真实 HTML Page（SDK shadow-root iframe）及筛选返回、手机抽屉导航。
- 浏览器拦截测试仅作用于验收 Session：将任务列表响应设为空仍能通过真实 ID 打开审阅；首次使用空数据引导；单个 PR 摘要失败时保留最近文件并通过重试恢复。拦截规则已移除。
- 1440×900 / 2000×700 / 390×844 截图检查；亮暗主题、中英文和有数据/空状态已覆盖。移动端主按钮实测最小 44×44px。
- Impeccable 检测返回空列表；独立审阅提出的四项问题已修复，获得限定于这些修改的 ship 结论。

仓库级 `pnpm typecheck` / `pnpm build` 仍受 Agent 插件的已安装 `unit-comparison-viewer`
副本缺失 `shared/diff-sidebar-rail.js` 阻塞（源 package 的 `.tsx` 存在）。仓库级 `pnpm test`
受未修改的 Desktop `profile-runtime.test.mjs:30` 调用 pnpm 配置读取后解析空 JSON 的失败阻塞。
上述失败没有通过跳过测试、改动类型检查或修改安装副本绕过。
