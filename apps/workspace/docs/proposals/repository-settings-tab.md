# Repository Settings tab

实施记录：2026-10-15。分支：`feat-github-ui-copy-5-setting-tab`。
仅调整 Repository view 的 Settings 内部页面；公共页头、tab、Wiki 布局、数据库和 HTTP contract 不改版。

## 布局与交互

- General、协作者、回收站共用 Settings 布局：最大宽度 1280px（含左右各 32px 内边距）、
  256px 左侧导航、40px 栏间距、24px 标题、32px 表单控件和 6px 圆角。
- 导航按 General / Access（协作者）/ Content（回收站）分组，采用蓝色选中标记、灰色选中底色、
  分隔线和 16px 图标。小于 768px 时上下排列，不增加不存在的 GitHub 设置。
- 名称和描述分别保存，只 PATCH 当前字段，避免把另一表单的未保存草稿一并提交。
  成功后留在 Settings 并刷新权威缓存；失败保留输入并显示错误。名称继续限制 100 字符，描述 350 字符。
- 公开读取放入 Danger Zone，通过确认对话框修改。文案说明真实的匿名只读语义，
  不承诺关闭后撤销既有成员、文件授权或其他分享入口。
- 协作者页内显示搜索、访问管理列表及添加对话框；沿用现有用户搜索、角色、添加和移除接口。
- 回收站使用紧凑列表，原始位置和条目数放入名称下方，保留删除时间、恢复及永久删除确认。
  请求期间禁用重复操作；永久删除由真实按钮触发，修复原 span trigger 的无效 ARIA 属性。
- 个人 Space 的 `manageMembers` 能力为 true，但现有成员路由只接受 Team Space，
  因此个人仓库隐藏这个原本不可用的入口。其他导航仍按服务端能力显示，未修改权限模型。
- Wiki 沿用原有统一保存、公开读取复选框及页头搜索布局。共享回收站的按钮可访问性修复同时适用。

## 原有能力验收

浏览器实测使用独立临时数据库与测试账号，不接触仓库 `.data` 或线上数据。

| 原有项目 | 新位置 | 验证结果 |
| --- | --- | --- |
| 名称 | General → Repository name → Rename | 空白校验；保存后留在 Settings；刷新保留新名称。 |
| 描述 | General → Description → Save | 独立保存；修改名称不提交描述草稿；失败保留草稿，恢复网络后可重试；刷新保留。 |
| 公开读取 | General → Danger Zone → Change visibility | 取消不写入；确认后启用匿名只读，刷新保留；公开读取权限另由既有集成测试验证。 |
| 仓库 ID 与复制 | 名称下方 | 完整 ID 仍可复制，窄屏仅视觉截断，复制成功提示通过。ID 仍为只读。 |
| 添加协作者 | Access → Collaborators → Add | 搜索测试用户并添加为 viewer，列表立即更新。 |
| 角色修改 | 协作者列表 | viewer → editor，刷新后 UI 和 GET 响应均为 editor；owner 继续锁定。 |
| 移除协作者 | 协作者列表 → Remove | UI 操作后 GET 成员列表不再包含测试用户。 |
| 恢复 | Content → Trash → Restore | 恢复后 Node GET 成功，回收站列表移除该项。 |
| 永久删除 | Content → Trash → Remove | Escape 取消保留条目；确认删除后列表为空，Node GET 返回 404。 |
| 权限 | 直接进入 Settings | viewer 的表单和可见性操作禁用，显示只读原因，管理导航隐藏；个人仓库仍可编辑 General。 |

## 参考与对比记录

实施时已完成截图对比；按要求不在仓库保留图片，以下保留参考来源、对比方法和结论。

参考为当前线上、已登录的 [dream-num/univer-workspace Settings](https://github.com/dream-num/univer-workspace/settings)。
只读查看，未修改任何 GitHub 仓库设置或账号主题。Workspace 为临时测试仓库。
**所有并排图均为左 GitHub、右 Workspace**，未改写页面文字或拼造设置项。

桌面视口均为 1440×900。下面为内容对齐裁剪：GitHub 从 y=100、Workspace 从 y=170 开始，
各保留 1440×700，区别来自既有公共仓库标题行。没有缩放任一侧。

可见性比较各截取同类区域 920×118；GitHub 从 (408,432)，Workspace 从 (408,603) 开始。

移动端视口均为 390×844，保留完整首屏，没有裁剪。

### 剩余差异

| 项目 | 当前差异与原因 |
| --- | --- |
| 信息密度 | Workspace 只有现有设置，未显示 GitHub 的分支、Rulesets、Actions、模板、归档、转移、删除仓库等；左导航与 General 明显更短。 |
| 描述与 ID | 保留 Workspace 原有描述、ID 和复制入口；GitHub 参考页的 General 不在这里编辑描述，也没有同类 ID 行。 |
| 可见性 | 使用 Workspace 的匿名只读开关和真实授权语义；不复制 GitHub 多阶段确认、组织策略和计费说明。确认弹窗沿用现有 Base UI 组件。 |
| 协作者 | 角色仍为 owner/admin/editor/viewer，直接添加 Workspace 现有用户；不伪造 GitHub 邀请、团队、组织权限或待接受状态。 |
| 回收站 | GitHub 没有同类设置页，按 Settings 的列表样式呈现 Workspace 的恢复和删除能力。 |
| 公共框架 | 沿用前一任务的品牌、breadcrumb、Star 和额外的仓库标题行；内容首屏比 GitHub 下移 70px，未在本任务修改公共框架。 |
| 移动端 | 两边都先显示设置导航；由于 Workspace 只有三个入口，首屏能更早看到表单。顶部仍使用公共框架的横向 tab 滚动，不复制 GitHub More 菜单。 |
| 字形和颜色 | 系统字体和 Lucide 与 GitHub 的字体/Octicons 仍有笔画差异；角色徽标沿用 Workspace 语义色。暗色危险按钮文字稍亮，以满足 4.5:1 对比度。 |

## 验证

- `pnpm typecheck`：全仓库通过。最终改动另通过 Workspace 类型检查。
- `pnpm build`：全仓库通过；最终 UI 另通过 `pnpm --filter @univerjs/univer-workspace build:web`。
- `pnpm --filter @univerjs/univer-workspace test`：73 个文件、353 项通过。
- 浏览器回归脚本通过（需要已安装的 `agent-browser` 与使用临时数据库的本地 Server/Vite）：

  ```bash
  WORKSPACE_TEST_ORIGIN=http://127.0.0.1:5173 node --test apps/workspace/test/browser/repository-settings.mjs
  ```

  覆盖独立保存、刷新持久化、空白名称、可见性确认/取消、失败重试、320px 溢出及个人仓库导航。
- 三页分别检查 320/390/768/1024/1440px，整页及 Settings 滚动区无横向溢出。
- General、协作者、含数据的回收站，及暗色 General：axe 均为 0 violations、0 incomplete。
  viewer General 同样通过。Enter 打开可见性确认、Escape 取消并恢复焦点；复制 ID 成功。
- 中英文切换正常；Wiki 仍显示原表单及 Public read 复选框。最终完整刷新后的功能回归没有捕获到
  未处理页面异常；开发热更新期间出现过异常，见下文。
- 修改的 TSX/MJS 文件通过 oxfmt；`git diff --check`、Impeccable detector 通过。
  仓库没有独立的全局 lint 脚本，现有 API lint 随 typecheck/build 通过。

### 未通过或未验证

- **开发 HMR 出现过 Provider 错误**：停止临时服务后返回的完整 Vite 日志显示，12:58:50 修改
  `i18n.tsx` 时，Fast Refresh 先报告 `browserLanguage` 导出不兼容并使模块失效，随后多个页面报
  `useI18n must be used within LanguageProvider`，并触发 `providers.tsx` 整页重载。
  现有 Provider 和 hook 同模块创建 Context，日志与热更新时 Context 身份变化相符，但未单独建立
  HMR 最小复现，不能将这一推断当作已证实根因。后续完整刷新的浏览器回归通过；本任务未重构
  全局 i18n/HMR 边界，也不宣称开发热更新全过程无错误。临时 Vite 的退出码 143 来自主动作业清理。
- **根 `pnpm test` 未全部通过**：未改动的 `apps/agent/desktop/test/profile-runtime.test.mjs:30`
  对 `pnpm config get overrides --json` 的空输出执行 `JSON.parse`，报 `Unexpected end of JSON input`。
  单独运行该测试可复现，且前一框架任务已有相同记录。未修改、屏蔽或跳过该测试。
- GitHub 协作者页要求再次验证身份（sudo mode），没有继续认证；该页没有逐像素对比或执行真实成员操作。
- GitHub 的暗色主题未切换，只有 Workspace 暗色截图及无障碍检查，没有伪造暗色并排参考图。
- 未验证 Safari、Firefox、真实触屏设备或读屏软件；未部署生产、未用真实线上数据验证。
