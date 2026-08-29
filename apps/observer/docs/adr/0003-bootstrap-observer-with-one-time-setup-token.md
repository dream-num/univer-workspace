---
status: accepted
---

# 使用一次性安装 Token 初始化 Observer Member

Observer 不在源码、默认配置或示例中预置任何 GitHub Identity。独立 Observer 数据库
没有 Member 时，部署者必须显式配置高强度的一次性安装 Token，在受保护的 Setup 流程中提交该
Token，并完成 GitHub OAuth；验证后的稳定 GitHub User ID 原子成为首位 Observer Member。

首位 Member 创建后，Setup 流程永久关闭，配置中残留的 Token 不再具有授权能力。未配置 Token 时
未初始化的 Console 保持锁定。普通的首次 GitHub 登录不能获得初始化权限。

该方案让任意 fork 和自托管部署都不依赖仓库维护者身份，也避免公开实例被“第一个登录者”抢占；
代价是部署者必须管理一个只用于初始化的 Secret，并完成一次额外的 Setup 操作。
