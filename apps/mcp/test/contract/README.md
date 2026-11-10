# Backend protocol contracts

`pnpm --filter @univerjs/univer-workspace-mcp test` runs these checks against the real executor and renderer servers in-process. Controllable Workspace, content-runtime, and renderer dependencies exercise deadlines, commits, and capability changes. Test names cite the [protocol](../../../../docs/design/workspace-mcp/backend-protocol.zh-CN.md) sections they prove.

For a deployed backend, set `MCP_CONTRACT_URL` to its base URL, `MCP_CONTRACT_ROLE` to `executor` or `renderer`, and `MCP_CONTRACT_TOKEN` privately in the environment. Run `pnpm --filter @univerjs/univer-workspace-mcp exec vitest run test/contract`. This runs the same framing, authentication, schema, request-limit, version, and rejection checks. Tests requiring controlled dependencies, gateway replicas, or the other role's secret are explicitly skipped with that reason. No Workspace credential is needed or sent in this mode.
