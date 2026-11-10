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
  (the build assembles its nine domain Skills with `apps/mcp/skills/core` into `dist/skill-data`;
  the CLI core is CLI-only and the gateway never reads `apps/cli` at runtime).
- Serve that static catalog through the official MCP Skills extension (`io.modelcontextprotocol/skills`)
  and the `skills_read` fallback. Keep both paths on the same snapshot and use
  `skill://univer-workspace/<name>/` URIs. MCP core owns tool bindings and remote file handling.
- Development session passthrough must never reach SaaS. Production refuses any non-empty `MCP_DEV_SESSION_PASSTHROUGH`.
- In production, the shared executor serves only allowlisted trusted users through `MCP_EXECUTOR_ALLOWED_USER_IDS`.
  Public executor access still requires Stage G.
- Treat the `mcp.tool_call` event in `README.md` as a stable versioned contract. Do not log credentials, document contents, or raw tool arguments.

Run `pnpm --filter @univerjs/univer-workspace-mcp typecheck`, `test`, and `build` for gateway changes.
Validate Docker changes against the built image and `docker compose config`.

- Executor-backed tools use `executorTool`; only that helper opens `ToolContext.executor`.
- `shared/executor-protocol.ts` owns the operation list. Executor handlers satisfy its mapped type.
- Gateway/shared code must not load headless or native packages. The import-boundary test enforces the role split.
- Required caller IDs enter every worker key. In production, session grants on the shared executor require
  allowlisted trusted users; public executor access still requires Stage G.
  Grant secrets are read only by `executor/credentials.ts`.
- Worker environments are explicit and exclude `MCP_EXECUTOR_TOKEN`, `MCP_RENDERER_TOKEN`, metrics tokens, license keys and OAuth secrets.
- `renderer/` has no route to Workspace: it must not import the gateway, Client Core, `@univerjs-pro/*` or the executor (except the generated `executor/license.ts`), and must not mention Workspace origins, grants or sessions. The import-boundary test enforces it.
- `shared/renderer-protocol.ts` owns the renderer operation list and its schemas; the executor imports it later. The render page ships in `dist/render-runtime` (copied from Client Core at build).
- The renderer pool reuses runtimes across requests and users. That deviates from architecture 7.1 until Stage G; keep it local and single-user.
