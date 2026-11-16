---
status: accepted
---

# 在 Commit Middleware 中写入 Mutation Size

Workspace 在 Trunk 与 Worktree 的 `commitChangeset` middleware 中计算 OT 变换后最终 mutations 的紧凑 JSON UTF-8 字节数。
从 SDK 1.5.2 起，通过公开的 `changeset.metadata.mutationSize` 将它与修订一同提交。Worktree 产品 HTTP 响应继续使用顶层
`mutationSize`；升级前的记录保留原协议载荷中的值。
