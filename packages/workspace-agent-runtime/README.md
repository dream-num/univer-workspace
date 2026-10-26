# Workspace Agent content runtime

Private headless implementation extracted unchanged from the existing Workspace Agent capability plugin. It owns the Facade worker pool, snapshot reader and draft changeset commit path; no chat, document store, permissions or Agent Runtime. The old capability plugin and isolated Space app consume this public package. Host credentials cross only into its private child process. Writes require a Worktree; Server authorizes every request.

Build with `pnpm --filter @univerjs/univer-workspace-agent-runtime build` before building either consumer. Node 24, SDK 1.1.0.
