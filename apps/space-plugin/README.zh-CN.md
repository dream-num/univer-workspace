# 面向官方 DeepSeek Harness 的 Space 插件

[English](README.md) | 简体中文

Space 是 Univer Workspace 的概念验证（POC）插件。它运行在官方 DeepSeek Harness（DSH）内部，
连接一个 Workspace 服务，让你浏览文件、编辑 Univer Docs 与 Sheets，并在打开的文档旁边与 AI
对话。

此预览针对 DSH 0.2.2-rc.1。它是在 DSH 内使用 Workspace 的一种可选方式，并不替代独立的
Workspace Agent 桌面应用。评估期间请使用非关键文档。

![Space 在 DeepSeek Harness 中的预览：文件导航、可编辑的 Univer 文档，以及浮动 AI 对话输入框。](docs/images/space-preview.png)

Space 让你的文档与对话输入框保持在同一视图内。该截图使用英文演示工作空间；示例消息是一条
未发送的草稿。

## 你能获得什么

- 以 Space 风格导航你的 Space、文件夹与文件，元数据经过真实 ACL 检查。
- 可协同编辑的 Univer Docs 与 Sheets，加上正式的 Slides、Canvas、Relational Table
  查看器，以及用于 Pages 的共享 Workspace HTML Viewer。
- `.md` Blob 的只读 Markdown 预览与源码视图。
- 浮动显示的原生 DSH Conversation，只有一套输入框与对话记录。
- 通过既有 Workspace 流程完成文件分享、重命名、移动、回收站与恢复，以及 Agent 变更的
  Worktree 审阅。

会话历史、输入框、模型、Agent 与工具日志由 DSH 管理。插件不修改官方宿主源码。

## 开始之前

Space 运行在官方 DeepSeek Harness Desktop 内部。请先从官方 DeepSeek Harness 项目安装
DSH 0.2.2-rc.1：
https://github.com/deepseek-ai/deepseek-harness

## 获取安装包

目前还没有公开的 Space GitHub Release。当前的临时入口是 **Space Plugin** GitHub Actions
workflow artifact，它包含一个 `.tgz` 安装包、`SHA256SUMS` 和 `build-info.json`，由 Actions
保留 30 天：
https://github.com/dream-num/univer-workspace/actions/workflows/space-plugin-build.yml

规划中的分发通道是基于 `space-plugin-v` 标签构建的 GitHub Prerelease。

## 三步安装并连接

1. 从 workflow artifact 下载 `.tgz` 安装包，并用 macOS 的 `shasum -a 256 -c SHA256SUMS` 或
   Linux 的 `sha256sum -c SHA256SUMS` 校验。
2. 在 DSH 中打开 Plugins，选择 Add plugin，把 tarball 路径粘贴到 Package name or
   address，安装，然后完全退出并重新启动 DSH。
3. 选择 Space 并选择 Sign in to Univer，在系统浏览器中完成授权。

在新 profile 上，安装器提示时请批准列出的 `protobufjs@7.6.6` 依赖构建。这是正常的依赖信任
步骤。

## 更新与卸载

更新时，先移除已有的 `dsh-space-plugin` bundle，安装已核验的新版 tarball 并完全退出后重新
启动 DSH。通过在 Plugins 中移除 `dsh-space-plugin` 并重启来卸载。热重装不受支持。

完整说明：[安装说明](docs/installation.zh-CN.md) ·
[Installation guide](docs/installation.md)

## 已知 POC 风险

- 在 DSH 0.2.2-rc.1 上，原生 Conversation 焦点在 inbox 插入之后捕获，而不是在发送手势时
  捕获，因此普通对话可能作用于更早的文档或选区。使用 AI 编辑时请检查目标与结果。独立的
  **Ask for change** 控件会在激活时捕获选区，是对某个选区做定向修改时更可预期的路径，但它
  并不能消除上述普通对话风险。
- 可靠的离线写入未启用：断连期间，新的内容编辑会暂停直到重连。
- History 仍未验收，Favorites 不可用，Space 的 Move/Trash/Restore 尚未实现。

## 文档

| 指南 | 范围 |
| --- | --- |
| [安装说明](docs/installation.zh-CN.md) | 安装包、安装、更新、卸载、首次使用、已知限制 |
| [Installation](docs/installation.md) | Package, install, update, uninstall, first use, limitations |
| [开发者指南](docs/development.zh-CN.md) | 构建、打包、行为参考与测试脚本 |
| [Developer guide](docs/development.md) | Build, packaging, behavior reference, test scripts |
| [管理员指南](docs/administration.zh-CN.md) | Server、OAuth 注册、备份与许可配置 |
| [Administration](docs/administration.md) | Server, OAuth registration, backup, license |
