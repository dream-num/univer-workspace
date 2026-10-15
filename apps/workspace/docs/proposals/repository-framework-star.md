# Repository 公共框架与 Star

实施记录：2026-10-15。范围为 Repository view 的公共页头、tab 栏与 Star；Code、Issues、
Pull requests、Settings 的内部内容和 About 区保持原样。Wiki 与匿名访客的既有布局不改版。

## 实现

- `features/spaces/repository-header.tsx`：公共名称、真实可见性、Star / Unstar 与计数。
- `features/spaces/repository-tabs.tsx`：Code 图标、16px 图标、32px tab 控件、44px 导航行、
  计数徽标、圆角 hover、珊瑚色选中线；窄屏横向滚动，并在异步计数改变宽度后保持选中项可见。
- 顶栏显示权威的 owner / 仓库名。Personal Space 继续沿用按所有者命名的展示规则，
  不把当前访问者误显示为所有者。名称与 URL 模型不改。
- 仅保留已有功能：Code、Issues（Team Space）、Pull requests、Pages、Settings（按权限）。
  所有已有仓库级路由通过同一组件取得页头和 Star，包括文件、Issue、成员与回收站子页。
- Star 乐观更新，请求期间禁用重复操作；失败回滚并提示重试，完成后重新读取服务端状态。
  保留键盘操作、焦点、`aria-current`、`aria-pressed` 和计数播报。

## 新增模型与接口

经确认新增产品库 V10 的 `space_stars(space_id, user_id, created_at)`，联合主键防止重复收藏，
外键随 Space/User 删除级联清理。不增加 Repository 实体，不维护冗余计数，不写协同数据库。

`GET /api/spaces/{spaceId}/star` 读取状态；`PUT` 收藏，`DELETE` 取消，均返回
`{ starred, starCount }`。写入幂等，身份只取 Session；三个方法均要求登录及当前 Space 访问权，
不可发现的目标返回 404。公开读取者可收藏，但不获得成员或编辑权限。
失去访问权时关系保留但不可访问，重新获得访问权后可继续读取或取消。

`SpaceView.owner` 新增 `{ id, username }`，只从已有 Space/User 关系投影，不改变所有权模型。
OpenAPI 源文件、生成物、服务端和 Browser 已同步。CLI 不新增命令。

V9 → V10 沿用启动迁移边界：校验旧指纹、一致性备份、事务、外键与完整性检查、新指纹校验。
失败回滚并保留备份，成功后重复启动不再迁移/备份。部署前停全部旧实例，由一个新实例完成升级；
回退需停止新实例并恢复备份，不能让 V9/V10 同时写入。

## 参考与对比记录

实施时已完成截图对比；按要求不在仓库保留图片，以下保留参考来源、对比方法和结论。

参考：2026-10-15 线上 [GitHub cli/cli](https://github.com/cli/cli)，未登录浏览。
本地：独立临时数据库中的 `repo-review / repository-demo`，已登录、英文界面。
每张并排图均为**左 GitHub、右 Workspace**，没有替换页面文字或计数。

桌面视口 1440×900，截取同一公共区域：GitHub 去掉顶部 72px 的全站营销导航，
两边均保留 1440×170px 的仓库面包屑、tab 和标题/操作行。
移动视口 390×844，GitHub 去掉 64px 全站导航，再各截取 390×220px；
两边真实的标题行高差异保留在图中。

### 剩余差异

| 项目 | 当前差异与原因 |
| --- | --- |
| 品牌和全站控件 | 保留 OfficeLab 图标与账户入口，不复制 GitHub 品牌、营销导航或不存在的搜索功能。 |
| 字体和图标 | 使用系统字体及已安装的 Lucide；与 GitHub 的 Mona Sans / Octicons 仍有字形和笔画差异。 |
| 功能入口 | 没有 Watch/Fork；无对应能力的 GitHub tab 不显示，保留 Workspace Pages。 |
| 移动导航 | 使用横向滚动，未实现 GitHub 的 More 折叠菜单；选中 tab 会自动滚入可视范围。 |
| 移动标题行 | 仅有 Star，空间足够时与名称同行；GitHub 参考页把多项操作放在下一行。 |
| owner | 显示真实用户名，但没有用户主页链接，因为 Workspace 没有对应页面。 |
| Star 的附属功能 | 没有收藏列表、计数详情和下拉菜单；按本任务要求使用 Unstar，而非 GitHub 部分状态中的 Starred。大计数显示精确数值而非 k 缩写。 |

## 验证

| 检查 | 结果 |
| --- | --- |
| `pnpm typecheck` | 全仓库通过；最终 Workspace 构建也执行 TypeScript 编译。 |
| `pnpm build` | 全仓库通过；后续公共导航改动另运行 Workspace 构建验证。 |
| Workspace 全量测试 | 70 个文件、349 项通过；随后新增名称回归测试及 Star/API/迁移定向测试通过。 |
| CLI 测试 | 通过，未新增 CLI 能力。 |
| `test:production-import` | 生产产物导入及 V0–V9 产品迁移、协同迁移矩阵通过。 |
| V9 → V10 | 空表/已发布 Blob/Issue、未完成上传/Operation/删除任务保留；失败回滚、可读备份、重启不重复迁移。源码和生产入口共用矩阵。 |
| `api:verify` | 通过。用临时 Git index 暂存当前生成物作为再生成基线；未改变用户 index，也未提交。 |
| 格式与设计检查 | 新增文件及重排组件的 oxfmt 检查、`git diff --check`、Impeccable detector 通过。仓库没有独立的全局 lint 脚本；API lint 已通过。 |
| 浏览器导航 | Code、Issues、Pull requests、Pages、Settings 均点击验证 URL 和唯一选中项；移动端直达 Settings 在计数加载后仍可见。 |
| 浏览器 Star | 0 → 1、Star → Unstar、刷新保留，再点击恢复 0；Enter/Space 可操作。断网请求回滚到 0 并提示。 |
| 权限与持久化 | HTTP 测试验证未登录 401、不可访问/不存在 404、公开读者可操作但不提权、不同用户独立状态、PUT/DELETE 幂等、服务重启保留。 |
| 响应式与无障碍 | 320/390/768/1024/1440px 无整页横向溢出；明暗主题公共框架 axe 各 0 violations、0 incomplete；正常加载无未处理页面异常。 |

### 未通过或未验证

- 根 `pnpm test` 未全部通过：未改动的
  `apps/agent/desktop/test/profile-runtime.test.mjs:30` 调用
  `pnpm config get overrides --json` 得到空输出，`JSON.parse` 报
  `Unexpected end of JSON input`。单独执行该测试同样失败，未跳过或修改它。
- 浏览器验证使用本机 Chromium；未验证 Safari、Firefox、真实触屏设备或读屏软件。
- 未登录 GitHub 账号执行真实 Star/Unstar，只对照公开页的视觉；Workspace 的状态与权限自行实测。
- 未部署生产服务，未对真实线上数据库执行升级；迁移验证全部使用临时数据。
