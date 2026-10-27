# Workspace Agent content runtime

Private headless implementation shared by the existing Workspace Agent and the isolated Space app. It owns the Facade worker pool, snapshot reader, changeset commits, Workspace directory and Resource operations, and the version-matched API reference query; it does not own chat, document storage, permissions or an Agent Runtime. Host credentials cross only into its private child process. The original draft-write entry requires a Worktree; the explicit trunk entry serves ordinary Space Agent edits, with the Server authorizing every request.

Build with `pnpm --filter @univerjs/univer-workspace-agent-runtime build` before building either consumer. Node 24, SDK 1.1.0.
