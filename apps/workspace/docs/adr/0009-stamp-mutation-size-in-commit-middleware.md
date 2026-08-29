---
status: accepted
---

# 在 Commit Middleware 中写入 Mutation Size

Workspace 在 Trunk 与 Worktree 的 `commitChangeset` middleware 中，以 OT 变换后 candidate
的 Mutations 紧凑 JSON UTF-8 字节数写入 `mutationSize`。尽管 SDK Context 的类型是
`Readonly<IChangeset>`，这里仍有意修改它，使持久化活动无需等待新 SDK Release 即可获得权威
最终大小。类型逃逸必须集中在一个位置并由集成测试覆盖；SDK 提供受支持的最终 candidate
元数据 Hook 后应移除该逃逸。
