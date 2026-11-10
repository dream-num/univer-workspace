# Space Plugin 安装说明

此包是供评估的概念验证预览，不是生产发布。目标宿主版本是官方 DSH 0.2.2-rc.1。Space 运行在
官方 DeepSeek Harness（DSH）内部，连接一个 Workspace 服务，让你浏览文件、编辑 Univer Docs 与
Sheets，并在打开的文档旁边与 AI 对话。它是在 DSH 内使用 Workspace 的一种可选方式，并不替代
独立的 Workspace Agent 桌面应用。评估期间请使用非关键文档。

## 环境要求

- 官方 DeepSeek Harness Desktop 0.2.2-rc.1，从官方 DeepSeek Harness 项目安装：
  https://github.com/deepseek-ai/deepseek-harness
- 一个 Workspace 服务与一个 Workspace 账户。默认服务为 `https://space.univer.ai/`。
  DSH Settings → Workspace 拥有账户、切换账户、退出登录与自定义 Workspace URL。
- 回环接口上的 3101 端口空闲，用于登录回流。

## 获取安装包

先查找 Space Plugin 发布版本。在仓库的 GitHub Releases 页面中，找到标签以 `space-plugin-v`
开头的预发布版本，下载该版本的 `.tgz` 安装包与 `SHA256SUMS` 文件：
https://github.com/dream-num/univer-workspace/releases

如果那里还没有可用的 Space Plugin 版本，改用 **Space Plugin** GitHub Actions 工作流成功构建
run 的 artifact。下载并解压后，其中包含一个 `.tgz` 安装包、`SHA256SUMS` 和
`build-info.json`。下载 Actions artifact 需要 GitHub 登录，且 Actions 只保留 30 天，因此这条
路径只作为临时的评估入口：
https://github.com/dream-num/univer-workspace/actions/workflows/space-plugin-build.yml

## 安装

1. 用 macOS 的 `shasum -a 256 -c SHA256SUMS` 或 Linux 的 `sha256sum -c SHA256SUMS` 校验下载
   得到的安装包。
2. 在 DSH 中打开 Plugins，选择 Add plugin，把 tarball 路径粘贴到 Package name or address，
   然后安装。
3. 完全退出 DSH 并重新启动。

在新 profile 上，安装器会要求批准 `protobufjs@7.6.6` 的依赖构建脚本。请确认列出的就是这个
包，选择 Allow these scripts 然后重试。这是正常的依赖信任步骤，不是 peer 警告失败。不要全局
启用所有依赖脚本。

## 首次使用

选择 Space 并选择 Sign in to Univer。在系统浏览器中登录并授权；授权成功后会加载 Space Home。
如果因 3101 端口已被占用而登录失败，请释放该端口后重试。被拒绝、取消或过期的请求也可以重试。
切换账户使用浏览器的 Workspace 账户：请在授权前于该处退出登录或选择所需账户。

## 更新

更新时，先移除已有的 `dsh-space-plugin` bundle，安装已核验的新版 tarball 并完全退出后重新
启动 DSH；先校验校验和。热重装可能遇到官方 DSH 模块身份诊断，因此不受支持。

## 卸载

通过在 Plugins 中移除 `dsh-space-plugin` 并重启来卸载。卸载也会移除导航适配器。你的数据不会
被删除：Workspace 文档保留在 Server 上，原生对话历史仍由 DSH 保留。

## License

打包的桌面 license 保持其既有授权范围与到期时间；打包不会延长两者。普通的 Desktop 启动不需要
额外的终端配置。

## 已知限制

- 在 DSH 0.2.2-rc.1 上，普通对话可能作用于比当前所见更早的文档或选区。使用 AI 编辑时请检查
  目标与结果。独立的 **Ask for change** 控件会在激活时捕获其选区，是对某个选区做定向修改时更
  可预期的路径，但它并不能消除普通对话的上述风险。
- 可靠的离线写入未启用。断连期间，新的内容编辑会暂停直到重连。
- History 仍未验收，Favorites 仍然不可用，Space 的 Move/Trash/Restore 尚未实现。

## 自建 Server 与更多文档

如果你运行自己的 Workspace 服务，其 Server 版本、OAuth 注册、备份与许可配置见管理员指南：
https://github.com/dream-num/univer-workspace/blob/main/apps/space-plugin/docs/administration.md

开发者指南包含详细的行为参考：
https://github.com/dream-num/univer-workspace/blob/main/apps/space-plugin/docs/development.md

仓库与源码：https://github.com/dream-num/univer-workspace ·
Univer 产品文档：https://docs.univer.ai/zh-CN
