# Workspace MCP

This private application is the remote MCP gateway, a Node-hosted Workspace client built on Client
Core. `README.md` describes its roles, tools, and configuration. The design is in
[the MCP design](../../docs/design/workspace-mcp/README.zh-CN.md), and
[the local verification specification](../../docs/design/workspace-mcp/local-verification.zh-CN.md)
defines how to verify it.

## Boundaries

- Reach Workspace only through its HTTP APIs and collaboration protocols. Never connect to a
  database. Workspace stays the authority for identity and permissions.
- `test/import-boundaries.test.ts` enforces the role split. The gateway and shared code never load
  headless or native packages and never import `apps/cli`. Only the `executorTool` helper opens
  `ToolContext.executor`, and only `src/executor/credentials.ts` reads grant secrets. `src/renderer`
  has no route to Workspace. It imports nothing from the gateway, Client Core, `@univerjs-pro/*`, or
  the executor except the generated `src/executor/license.ts`, and never handles Workspace origins,
  grants, or sessions. Keep new code inside these rules instead of loosening the test.
- Keep identity origin separate from transport origin. Display and resolve references against the
  identity origin.

## Tools and protocols

- Keep tools in the ordered registry, one file per tool under its toolset. Each tool declares input
  and output schemas and all three annotations, and maps arguments and results onto public Client
  Core exports.
- `src/shared/executor-protocol.ts` owns the executor operation list, and executor handlers satisfy
  its mapped type. `src/shared/renderer-protocol.ts` owns the renderer operation list and schemas.
  The build copies the render page from Client Core into `dist/render-runtime`.
- `scripts/assemble-skills.mjs` builds the static Skill catalog in `dist/skill-data` from fixed
  lists of Skills in `skills/` and `apps/cli/skill-data`, so add a new Skill to its list. The MCP
  `core` Skill owns tool bindings and remote file handling. The gateway never reads `apps/cli` at
  runtime. Serve the catalog through the MCP Skills extension (`io.modelcontextprotocol/skills`) and
  the `skills_read` fallback from the same snapshot, with `skill://univer-workspace/<name>/` URIs.
  `skills_read` also finds live custom Skills in `.agents/skills` of the caller's Personal Space and
  optional member repository. Custom Skills never enter the Skills extension.
- Treat the `mcp.tool_call` event in `README.md` as a stable, versioned contract. Never log
  credentials, document contents, or raw tool arguments.

## Executor and renderer

- The executor has no isolation between users. In production it serves only the trusted users that
  `MCP_EXECUTOR_ALLOWED_USER_IDS` admits, and public executor access needs Stage G, which is
  shelved. Every worker key includes the required caller IDs.
- The renderer pool reuses runtimes across requests and users, which departs from section 7.1 of
  the MCP architecture. Until per-task isolation returns, keep the renderer to local and internal
  single-user environments.
- Worker environments are explicit and exclude `MCP_EXECUTOR_TOKEN`, `MCP_RENDERER_TOKEN`, metrics
  tokens, license keys, and OAuth secrets.
- Every process the executor starts gets `EXECUTOR_CHILD_NODE_OPTIONS` (`--disable-sigusr1`) in its
  environment, and the image starts each role with the same flag. The production executor refuses
  Node inspector flags. A new child process keeps both rules.
- Development session passthrough never reaches SaaS. Production refuses a non-empty
  `MCP_DEV_SESSION_PASSTHROUGH`.

## Verification

- For gateway changes, run `pnpm --filter @univerjs/univer-workspace-mcp typecheck`, `test`, and
  `build`.
- Validate Docker changes against the built image and `docker compose config`. When you change the
  `COPY` inputs in `Dockerfile`, change the build-input list in section 3.1 of the local
  verification specification to match. `verify-uvw` hashes the same list.
