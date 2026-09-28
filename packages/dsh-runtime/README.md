# dsh-runtime

Standalone nested workspace package: it declares the DSH runtime cohort (`@deepseek-ai/dsh`
CLI, the two client-UI packages, `dsh-agent-presets` templates, and the pnpm build used by
the shipped profile) and pins the complete transitive closure in its **own committed
`pnpm-lock.yaml`**. There is no source code, nothing imports this package, and it is never
published. The root `pnpm-workspace.yaml` explicitly excludes it: sharing the root
resolution domain re-resolves consumers' optional peers, which splits branded types
(`SessionId`, `Context`) across the workspace and breaks consumer typechecks.

Consumers materialize the cohort as a self-contained, hoisted tree with:

```bash
pnpm --dir packages/dsh-runtime install --frozen-lockfile
pnpm --dir packages/dsh-runtime deploy --legacy --filter @univerjs/univer-workspace-dsh-runtime \
  --prod --config.node-linker=hoisted <target>
```

- `apps/agent/desktop/scripts/prepare.mjs` → `.build/runtime/bootstrap` (packed into the
  desktop artifact's `host.asar` root);
- `apps/agent/Dockerfile` → `/opt/dsh/bootstrap` (the server image's dsh CLI install).

## Responsibilities

- Own **which published DSH versions this repository validates and ships**. Upgrading
  the cohort means bumping the exact pins here, regenerating this directory's
  `pnpm-lock.yaml` (`pnpm install` inside it), updating the matching `@deepseek-ai/*`
  peer declarations in `apps/agent` and `DSH_WEB_BUNDLE`, and landing all of it in one
  commit.

## Non-responsibilities

- It does not own DSH product behavior (DSH is an external product; this repository does
  not fork or patch it).
- It does not own profile assembly (`dsh plugin add`, `portable-profile.mjs`) or preset
  template contents (owned by the upstream `dsh-agent-presets` package).
