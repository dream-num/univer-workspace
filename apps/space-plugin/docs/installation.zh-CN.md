# Space Plugin 安装说明

此包是供评估的概念验证预览，不是生产发布。目标宿主版本是官方 DSH 0.2.2-rc.1。导航适配器
识别已发布的 Web 构建 0.2.2-rc.1 / c59d10a。Desktop 0.2.2-rc.1 的安装与原生回流验收仍未完成。

Space 运行在官方 DeepSeek Harness（DSH）内部，连接一个 Workspace 服务，让你浏览文件、编辑
Univer Docs 与 Sheets，并在打开的文档旁边与 AI 对话。它是在 DSH 内使用 Workspace 的一种
可选方式，并不替代独立的 Workspace Agent 桌面应用。评估期间请使用非关键文档。

该包不包含第二套 DSH runtime，也不包含本地 Workspace Server。

## 环境要求

- 官方 DeepSeek Harness Desktop 0.2.2-rc.1，从官方 DeepSeek Harness 项目安装：
  https://github.com/deepseek-ai/deepseek-harness
- 一个 Workspace 服务与一个 Workspace 账户。默认服务为 `https://space.univer.ai/`；
  DSH Settings → Workspace 拥有账户、切换账户、退出登录与自定义 Workspace URL。
- 回环接口上的 3101 端口空闲，用于 OAuth 回流。

## 安装

1. 获取下载得到的 `.tgz` 安装包，并用 macOS 的 `shasum -a 256 -c SHA256SUMS` 或 Linux 的
   `sha256sum -c SHA256SUMS` 校验其校验和。
2. 在 DSH 中打开 Plugins，选择 Add plugin，把 tarball 路径粘贴到
   Package name or address，然后安装。
3. 完全退出 DSH 并重新启动。

在新 profile 上，pnpm 会阻止传递依赖 protobufjs@7.6.6 的 postinstall，直到显式批准。
在官方安装器中，确认这是列出的那个包并选择 Allow these scripts 然后重试。这是正常的依赖信任
步骤，不是 peer 警告失败。所发布的那个 postinstall 精确地读取依赖元数据并打印版本方案警告；
它不下载任何可执行文件。不要全局启用所有依赖脚本。

## 更新

更新时，先移除已有的 `dsh-space-plugin` bundle，安装已核验的新版 tarball 并完全退出后重新
启动 DSH；先校验校验和。

热重装可能遇到官方宿主模块身份诊断，因此不受支持。

## 卸载

通过在 Plugins 中移除 `dsh-space-plugin` 并重启来卸载。卸载也会移除导航适配器。
Workspace 文档保留在 Server 上；原生对话历史由 DSH 拥有。

## 首次使用

选择 Space 并选择 Sign in to Univer。在系统浏览器中登录并授权；授权成功后会加载
Space Home。宿主凭据提供方只持久化插件自己的授权；客户端不收到 cookie 或 token。
DSH 模型凭据与原生 Session 仍由 DSH 拥有。被拒绝、取消或过期的请求可以重试。
切换账户使用浏览器的 Workspace 账户；请在授权前于该处退出登录或选择所需账户。

## 从哪里获取安装包

目前还没有公开的 Space GitHub Release。当前的临时入口是 **Space Plugin** GitHub Actions
workflow artifact，它包含一个 `.tgz` 安装包、`SHA256SUMS` 和 `build-info.json`，由 Actions
保留 30 天：
https://github.com/dream-num/univer-workspace/actions/workflows/space-plugin-build.yml

从成功的 GitHub Actions run 中下载并解压，校验校验和，然后按[安装](#安装)所述安装该
tarball。这些 workflow artifact 是供评审的构建产物，不是 GitHub Release 或 npm 发布。

规划中的分发通道是基于 `space-plugin-v` 标签构建的 GitHub Prerelease。在该 prerelease
出现之前，请使用上面的 workflow artifact。

## Server 要求

Server 必须运行匹配的发布 commit（包括 Review/Apply 修复），以单一写进程对持久化产品
SQLite、协同 SQLite 与 Blob 存储运行。请一起备份这些存储。升级前停止旧的写进程；绝不重置
数据库。远程服务需要 HTTPS/WSS、已注册的公共 OAuth 客户端 `univer-workspace-harness`
（带 consent 与 `identity session` scopes），以及针对 /api、/universer-api 与协同
WebSocket upgrade 的反向代理支持。插件期望的是一个服务 origin，而不是 API 路径。

现有云端注册接受精确的回环返回地址 `http://127.0.0.1:3101/auth/oauth/callback`。
自定义 Server 管理员必须注册同一个精确回调。插件只为待处理的授权绑定 IPv4 回环，
并在完成、取消或超时时关闭它。请保持该端口空闲；冲突的监听会产生可重试的登录错误，
绝不会回退到凭据表单。原生 Desktop 的外部浏览器转发与返回链接需要在 0.2.2-rc.1 上单独
验收。返回链接可能触发操作系统/浏览器的确认。不使用 `univer-workspace://` scheme，
也不使用 DSH 账户授权。

多 Unit SDK 合并是按 Unit 的，不是跨 Unit 事务；Space 当前的文档 Agent 编辑只针对一个
Doc 或 Sheet。

管理员细节、备份流程与许可配置记录在仓库的管理员指南中：
https://github.com/dream-num/univer-workspace/blob/main/apps/space-plugin/docs/administration.md

## 本包中的 License

Desktop 测试包在仅宿主的 `lib/runtime-license.json` 中包含仓库现有的 Workspace 应用
license，因此普通的 Desktop 启动不需要终端环境变量。非空的 UNIVER_LICENSE 可以覆盖打包
的值。既有的运行时配置路由要求身份认证且仅允许所有者访问，会把它提供给官方 LicensePlugin；
它不会被保存在客户端偏好中，也不会被包含在 Agent 上下文中。打包不会延长它的范围或到期
时间。

该包同时携带所依赖组件的第三方声明。

## 已知限制

**官方 DSH 0.2.2-rc.1 上的原生 Conversation 焦点**仍然是在 inbox 插入之后从 Host 状态
捕获，而不是在发送手势时捕获。因此，仍在传输中的选区更新可能使该消息快照中保留一个更早
的目标。代次顺序与原生发送阶段都不能关闭这个窗口。精确的原生发送绑定需要 DSH 提供
受支持的按次快照/接纳 API；输入框阻塞与 pre-step 钩子都不提供它。这是一个已知的 POC
风险：普通对话可能作用于更早的文档或选区。使用 AI 编辑时请检查目标与结果。独立的
**Ask for change** 控件会在激活时捕获其 SDK 选区，并保留既有的目标、内容、权限与 revision
检查；它是对某个选区做定向修改时更可预期的路径，但它并不能消除上面描述的普通对话风险。

可靠的离线写入未启用。断连期间，新的内容编辑会暂停直到重连。SDK 的排队在线变更恢复仍然
启用。

History 仍未验收。Favorites 仍然不可用。Space 的 Move/Trash/Restore 需要单独的生命周期
扩展，尚未实现。

## 更多文档

- 仓库与源码：https://github.com/dream-num/univer-workspace
- Univer 产品文档：https://docs.univer.ai/zh-CN
- 开发者指南、详细行为参考与测试脚本：
  https://github.com/dream-num/univer-workspace/blob/main/apps/space-plugin/docs/development.md
- 管理员指南：
  https://github.com/dream-num/univer-workspace/blob/main/apps/space-plugin/docs/administration.md
