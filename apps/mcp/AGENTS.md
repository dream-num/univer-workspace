# Workspace MCP

Read the root `AGENTS.md` and [MCP design](../../docs/design/workspace-mcp/README.zh-CN.md) before changing this application.
The [local verification specification](../../docs/design/workspace-mcp/local-verification.zh-CN.md) binds Stage A behavior.

- This private application is not published to npm. It is the third Node-hosted Workspace client, built on Client Core.
- Connect through Workspace HTTP APIs and collaboration protocols. Never connect to a database.
- Never import `apps/cli`. Tools map arguments and results onto the public Client Core exports.
- Keep tools in the ordered registry, with one file per tool under its toolset. Every tool declares input and output schemas and all three annotations.
- Keep identity origin separate from transport origin. Display and resolve references against the identity origin.
- Keep the Dockerfile COPY inputs and the verify-uvw build-input list in specification section 3.1 synchronized.
  The inputs are root `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `.npmrc`, `patches/`, `tsconfig*.json`,
  all non-ignored files under `apps/mcp/` and `packages/client-core/`, including `render-runtime/`, and `apps/cli/skill-data/`
  (the build copies it to `dist/skill-data`; the gateway never reads `apps/cli` at runtime).
- Development session passthrough must never reach SaaS. Production refuses any non-empty `MCP_DEV_SESSION_PASSTHROUGH`.
- Until Stage G passes, use this application only locally or in internal single-user environments.
- Treat the `mcp.tool_call` event in `README.md` as a stable versioned contract. Do not log credentials, document contents, or raw tool arguments.

Run `pnpm --filter @univerjs/univer-workspace-mcp typecheck`, `test`, and `build` for gateway changes.
Validate Docker changes against the built image and `docker compose config`.
