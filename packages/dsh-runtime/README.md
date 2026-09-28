# dsh-runtime

Manifest-only workspace package: it declares the DSH runtime cohort (`@deepseek-ai/dsh`
CLI, the two client-UI packages, and the pnpm build used by the shipped profile) so the
**root `pnpm-lock.yaml` records the complete transitive closure**. There is no source
code, nothing imports this package, and it is never published.

Consumers materialize the cohort as a self-contained, hoisted tree with
`pnpm deploy --filter @univerjs/univer-workspace-dsh-runtime --prod --config.node-linker=hoisted <target>`:

- `apps/agent/desktop/scripts/prepare.mjs` → `.build/runtime/bootstrap` (packed into the
  desktop artifact's `host.asar` root);
- `apps/agent/Dockerfile` → `/opt/dsh/bootstrap` (the server image's dsh CLI install).

## Responsibilities

- Own **which published DSH versions this repository validates and ships**. Upgrading
  the cohort means bumping the exact pins here, updating the matching
  `@deepseek-ai/*` peer declarations in `apps/agent` and `DSH_WEB_BUNDLE`, and running
  `pnpm install` — manifest and lockfile land in one commit.

## Non-responsibilities

- It does not own DSH product behavior (DSH is an external product; this repository does
  not fork or patch it).
- It does not own profile assembly (`dsh plugin add`, `portable-profile.mjs`) or preset
  template contents (owned by the upstream `dsh-agent-presets` package).
