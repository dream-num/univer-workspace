# Space Plugin 管理员指南

本指南覆盖 Space 插件背后的运维职责：它所依赖的 Server、需要的 OAuth 注册、必须备份的数据，
以及 runtime license 的配置方式。安装步骤在
[installation.zh-CN.md](installation.zh-CN.md)；技术行为与测试在
[development.zh-CN.md](development.zh-CN.md)。

Space 是供评估的概念验证预览，不是生产发布。目标宿主版本是官方 DSH 0.2.2-rc.1。导航适配器
识别已发布的 Web 构建 0.2.2-rc.1 / c59d10a。Desktop 0.2.2-rc.1 的安装与原生回流验收仍未
完成。

## Server

Server 必须运行匹配的发布 commit（包括 Review/Apply 修复），以单一写进程对持久化产品 SQLite、
协同 SQLite 与 Blob 存储运行。请一起备份这些存储。升级前停止旧的写进程；绝不重置数据库。
远程服务需要 HTTPS/WSS、已注册的公共 OAuth 客户端 `univer-workspace-harness`（带 consent 与
`identity session` scopes），以及针对 /api、/universer-api 与协同 WebSocket upgrade 的反向
代理支持。插件期望的是一个服务 origin，而不是 API 路径。多 Unit SDK 合并是按 Unit 的，不是
跨 Unit 事务；Space 当前的文档 Agent 编辑只针对一个 Doc 或 Sheet。

该插件不包含本地 Workspace Server，也不包含第二套 DSH runtime。所有文档数据都留在它所连接的
Server 上。

## OAuth 注册

现有云端注册接受精确的回环返回地址 `http://127.0.0.1:3101/auth/oauth/callback`。插件只为
待处理的授权绑定 IPv4 回环，并在完成、取消或超时时关闭它。请保持该端口空闲；冲突的监听会
产生可重试的登录错误，绝不会回退到凭据表单。自定义 Server 管理员必须注册同一个精确回调。

已认证的公共 DSH Connection 启动/取消请求；回环监听只接受有界且 state 匹配的 OAuth 回调。
原生 Desktop 的外部浏览器转发与返回链接需要在 0.2.2-rc.1 上单独验收。返回链接可能触发操作
系统/浏览器的确认。不使用 `univer-workspace://` scheme，也不使用 DSH 账户授权。

请注册公共 OAuth 客户端 `univer-workspace-harness`，scope 为 `consent` 与
`identity session`，并注册上面那个精确的回环回调。插件期望的是一个服务 origin，而不是 API
路径。

## 账户与会话

首次使用：选择 Space 并选择 Sign in to Univer。在系统浏览器中登录并授权；授权成功后会加载
Space Home。DSH Settings → Workspace 管理当前账户与服务器、切换账户、退出登录与自定义
Workspace URL。Session 复用使用官方宿主凭据提供方的隔离 `dsh-space-plugin/workspace` 授权
记录。只有该记录会被改变；DSH 模型凭据与原生 Session 仍由 DSH 拥有。被拒绝、取消或过期的
请求可以重试。切换账户使用浏览器的 Workspace 账户；请在授权前于该处退出登录或选择所需账户。

## 备份与升级

请一起备份产品 SQLite、协同 SQLite 与 Blob 存储；它们是一个一致的集合。升级前先停止旧的写
进程，再用同一批存储启动新的写进程。绝不把重置数据库当作升级或恢复步骤。

## License 配置

Desktop 测试包在仅宿主的 `lib/runtime-license.json` 中包含仓库现有的 Workspace 应用 license，
因此普通的 Desktop 启动不需要终端环境变量。非空的 UNIVER_LICENSE 可以覆盖打包的值。既有的
运行时配置路由要求身份认证且仅允许所有者访问，会把它提供给官方 LicensePlugin；它不会被保存在
客户端偏好中，也不会被包含在 Agent 上下文中。打包不会延长它的范围或到期时间。

打包器从仓库源码读取 license 与配套的 Exchange 校验密钥，并写入仅宿主的打包运行时配置。
若该文件缺失或与当前源码不一致，打包与资源扫描会失败。构建日志和已提交的生成文件中不会写入
任何 license 值。

该 license 既有的范围与到期时间仍然适用；校验仍由 SDK 负责。

## 依赖信任

在新 profile 上，pnpm 会阻止传递依赖 protobufjs@7.6.6 的 postinstall，直到显式批准。在官方
安装器中，确认这是列出的那个包并选择 Allow these scripts 然后重试。这是正常的依赖信任步骤，
不是 peer 警告失败。所发布的那个 postinstall 精确地读取依赖元数据并打印版本方案警告；它不
下载任何可执行文件。不要全局启用所有依赖脚本。

发布脚本只暂存运行时文件、仅生产用的清单、声明与 npm-shrinkwrap.json。npm 消费者遵循该
lock；DSH 的 pnpm 管理器拥有其 profile lock 并需要 registry 访问。请保留 profile lock 以便
完全一致地重装。在分发新产物前，运行发布扫描与实际的干净 profile 安装。

## 发布门槛

目前还没有公开的 Space GitHub Release。当前的临时入口是 **Space Plugin** GitHub Actions
workflow artifact，它包含 `space-plugin-<version>-<short-sha>.tgz`、`SHA256SUMS` 和
`build-info.json`，由 Actions 保留 30 天。这些 workflow artifact 是供评审的构建产物，不是
GitHub Release 或 npm 发布。

规划中的分发通道是基于 `space-plugin-v` 标签构建的 GitHub Prerelease。在该 prerelease 出现
之前，请使用 workflow artifact。

Desktop 0.2.2-rc.1 的安装与原生回流验收仍未完成。

## 复现演示

用一个一次性的 Team Space 与两个账户复现演示：创建一个 Folder 与全部六种内容类型；重命名/
移动/放入回收站/恢复一个文件；从两个客户端编辑 Docs/Sheets；与第二个账户共享并添加一条
评论。把一个 Doc 与原生对话关联，请 Agent 向一个私有 Worktree 追加一个唯一段落并标记为
ready，检查 Review，显式 Apply，并验证已打开的第二个客户端与一次重开。用 Sheet 公式、Reject
以及 Review 之后的一次共享编辑重复该流程；验证 SDK 的合并/冲突行为与持久化结果。Viewer /
被移除成员的写入必须失败。不包含任何测试 fixture、模型凭据或私有 Session 归档。
