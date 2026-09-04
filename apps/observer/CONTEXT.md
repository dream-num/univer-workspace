# Univer Observer 术语

**Observer**：
独立部署的 Workspace 只读观测应用。它拥有自己的 HTTP Server、Browser、身份和持久化，不能修改
Workspace 产品或 Collaboration 状态。
_Avoid_: Workspace Admin Route、Workspace Backend Page

**Observer Identity**：
用于登录 Observer、绑定稳定 GitHub Numeric User ID 的已验证 GitHub 身份。它不是 Workspace User。
_Avoid_: Workspace User、GitHub Login Text

**Observer Member**：
已获准访问 Observer 的 Identity。所有 Member 权限相同，可以查看观测数据并管理其他 Member；系统
必须保留最后一位 Member。
_Avoid_: Admin、Workspace Member

**Observer Setup**：
Member 表为空时，部署者用一次性安装 Token 开始 GitHub OAuth，并原子创建首位 Member 的过程。
仓库不得预置身份，也不得采用“第一个普通登录者获权”。

**Changeset Write**：
成功持久化到 Trunk 或 Worktree Collaboration 历史、带权威服务端创建时间的 Changeset。
_Avoid_: submitChangeset 请求、编辑动作

**Changeset Activity Measure**：
时间桶内的 Changeset Write 数、Mutation 数或持久化 `mutationSize` 总量。
_Avoid_: HTTP 请求频率、完整 Payload 大小

**Mutation Size**：
最终 Mutations 数组紧凑 JSON 的 UTF-8 字节数。Observer 只读取该可选元数据，不负责计算或回填。
