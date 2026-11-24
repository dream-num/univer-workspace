# Univer Workspace

This repository composes Univer, Univer Pro, the Univer Collaboration SDK, and the
Univer CLI SDK into the Workspace product. It ships the Workspace Browser and Server,
the `uvw` CLI, a remote MCP gateway, and the Workspace Agent. `README.md` describes
the layout and how to run each application. `DREAMNUM.md` records cross-repository
ownership and handoffs.

## Nested instructions

Read the nested file before you change anything under its directory. Some tools load
instructions only from the working directory upward and never see these files.

| File                                               | Read before changing                                                   |
| -------------------------------------------------- | ---------------------------------------------------------------------- |
| `apps/workspace/AGENTS.md`                         | Product database schema, migrations, startup, or deployment            |
| `apps/workspace/web/src/features/agents/AGENTS.md` | Browser Agents prompt assembly, message conversion, or session records |
| `apps/cli/AGENTS.md`                               | CLI commands, startup imports, or packaging                            |
| `apps/mcp/AGENTS.md`                               | The MCP gateway, executor, renderer, or their Docker inputs            |
| `apps/space-plugin/AGENTS.md`                      | The Space plugin for DSH Desktop                                       |

## Language Settings

- Write `AGENTS.md` and `AGENTS.override.md` in English. Keep shared project
  principles and language settings in sync; local workflows belong only in the
  Git-ignored `AGENTS.override.md`.
- Write narrative content in RFCs, research notes, and other project documents
  primarily in Chinese, unless the user requests another language.
- Use English for all code, including example code, pseudocode, and comments.
- Use English for key terms in all documents. Preserve required headings,
  identifiers, and paths.
- Issues: English title (Conventional Commits style), Chinese body with English key terms.
- PRs: English title (Conventional Commits style) and English body. Put review-only details in
  Chinese (decisions for the maintainer, deviations, verification notes, known limits) in the first
  PR comment, posted right after `gh pr create`.
- Commit messages (subject and body) are always English

## Ownership

- Upstream SDKs own their contracts. Univer and Univer Pro own the Unit model, Facade API,
  mutations, rendering, and Office exchange. The Collaboration SDK owns snapshots, changesets,
  revisions, OT, Worktrees, and its database adapters. The CLI SDK owns the target-neutral
  headless runtime. This repository owns the product model, authentication, the resource
  catalog, remote workflows, and deployment. Compose upstream public capabilities directly at the
  application boundary, without pass-through wrappers or local copies of upstream contracts.
  Before you fix a cross-SDK bug, decide which side owns it and tell the user why.
- Use other SDKs only through the public exports of published packages. No code, build, test,
  or generator may depend on a neighboring checkout, an absolute path into another repository,
  or unpublished source.
- `apps/*` compose packages. Packages under `packages/*` never import an application, and no
  package imports another package's `src` or `dist` internals. Private packages have no release,
  version, or external consumer contract of their own.
- `packages/client-core` takes the origin, credentials, license, and worker entry from the client
  that hosts it, and never reads CLI sessions or configuration.
- `packages/reference-provider` serves only the Workspace Browser, and the CLI keeps its own
  provider. They share persisted identity and behavior. Do not create a shared contract only to
  remove the duplicated code.
- `packages/dsh-univer-workspace-plugin` gets the `workspaceAuth` and `workspaceSession` services
  from `apps/agent` through cordis service composition, not through an npm dependency.
- DSH is an external product. Use it only through published `@deepseek-ai/*` packages, and never
  fork or patch its source.
- `packages/unit-comparison-viewer` also has a copy in the `dream-num/univer-cli` repository.
  When you change it here, tell the user the other copy needs the same change.

## Data and trust

- Product data and collaboration data live in separate stores. The product database never stores
  snapshots, changesets, or revisions. The Collaboration adapter never owns Spaces, Nodes,
  Resources, or ACLs. `BlobStore` holds Blob and embedded Asset bytes, and the product database
  holds only their identity, metadata, and recovery state.
- No transaction spans the product database, the Collaboration Service, and `BlobStore`.
  Cross-boundary writes converge through persisted Operations, idempotency, and recovery.
- The Workspace server must stay correct with more than one replica, even while production runs
  one. Keep locks, one-time codes, pending approvals, rate counts and idempotency records in the
  product database or another shared store, and check server-side facts at the decision point
  instead of serializing requests in memory. A per-replica cache that any replica can rebuild is
  fine. Process-local state that predates this rule is tracked in issue #564; do not copy it.
- The server derives the user, role, Resource, Unit, Worktree, and confirmed revision from the
  authenticated session and product data. It never accepts them from a Browser or CLI client.
- An HTML View is a small app bound to live Sheet data. Rendering, sharing, and preview always
  read live data, so never add snapshots, static export, or inlined data copies. A user with edit
  permission writes page edits to the source Sheet in real time, and trial mode must never weaken
  that. A user without it follows the
  repository's document permission. When the host enables trial mode, that user's edits run
  through the real formula engine in their own browser and are never saved or sent.

## SDK versions

- Every version-coupled `@univer-cli/*`, `@univerjs/*`, and `@univerjs-pro/*` dependency in the
  pnpm workspace uses one exact SDK release. Change it only with
  `pnpm update:univer-sdk --sdk_version <exact-version>`, and commit every changed manifest with
  `pnpm-lock.yaml`. `apps/space-plugin` has its own npm graph outside the pnpm workspace, and the
  command does not touch it.
- `scripts/update-sdk-dependencies.mjs` lists the packages that keep their own exact versions and
  the native bindings that only their wrapper packages declare. It also rejects any SDK entry in
  `pnpm-workspace.yaml` `overrides` that is not a dev or insiders version.
- Rotate the bundled runtime license only with
  `pnpm update:univer-license --license <file> --license-key <file>`. Never edit the generated
  `license.ts` files.

## React and Redi dependency boundaries

- Workspace Browser uses React 19. The published DSH browser packages that Workspace Agent uses
  run React 18. Keep the split. Never add a `@deepseek-ai/*` package that brings React 18 to
  another application's manifest, resolve React from a neighboring application, or bundle a second
  React runtime into one application.
- `packages/dsh-runtime` pins the DSH CLI runtime in its own nested workspace and lockfile, and
  the build materializes it with `pnpm deploy`. Keep it out of the root workspace graph. A shared
  graph re-resolves optional peers and splits branded DSH types such as `SessionId`.
- Get DI APIs and types from `@univerjs/core`, which owns the `@wendellhu/redi` dependency. Do not
  add direct Redi imports or dependencies. The install holds one Redi instance per React peer
  context, all with the same version number, so a matching version does not prove a shared
  instance.
- `pnpm test:sdk-dependencies` runs `scripts/sdk-type-identity.test.mjs`, which type-checks DI
  identity in the Browser and Agent graphs. If an SDK release fails it with an undeclared Redi
  reference, treat that as an upstream defect. Add a version-scoped `packageExtensions` entry with
  its evidence and removal condition, and verify it after a clean install. Do not force one React
  version, add broad overrides, patch installed packages, or weaken typechecking.
- Data-only code imports `@univer-cli/doc-markdown-facade/files`, not `/node`, which brings headless
  runtime types into the TypeScript graph. The same test asserts this only for the Client Core
  `/markdown` and `/document-materialize` entries. Clear TypeScript build state
  before you recheck a dependency metadata change, because incremental builds can keep the old
  graph.

## Generated files

- Never edit generated files or Git-ignored local output, such as `apps/workspace/generated/http`
  or the TanStack Router route tree. Change the source or the generator, then regenerate.
- `apps/workspace/contracts/http` is the source of the product HTTP contract. After you change it,
  run `pnpm --filter @univerjs/univer-workspace api:verify`, and update the server routes, Browser,
  CLI, MCP tools, tests, and docs that use it in the same change.

## Compatibility code and workarounds

Keep data compatibility, migration, and compensation logic out of normal paths, in one idempotent
entry point that states its scope, failure behavior, and exit condition. Isolate each workaround
in one place with its reason, impact, and removal condition. Delete it when upstream fixes the
cause.

## Verification

- `pnpm verify` runs the stages of the CI `verify` job. `pnpm verify --stage <name>` runs one of `static`,
  `test-workspace`, `test-cli`, `test-mcp`, `test-rest`, or `package`. `pnpm check` is the short
  typecheck and test loop. These cover the pnpm workspace only. `apps/space-plugin` has its own
  npm scripts.
- To prove a Workspace or CLI change in the real app, use the `verify-uvw` skill. For any change
  under `apps/workspace/server/src/db` or to the SDK baseline, use the `verify-db-migration` skill.
- When you change CLI packaging, runtime assets, or bundled Skills, verify the built artifact from
  `pnpm package:workspace-cli`, not only the source.
- `pnpm check:agents-md` checks that the paths and scripts named in every `AGENTS.md` exist. Use
  the `maintain-agentsmd` skill when you add to or revise these files.

## Documentation

- `apps/workspace/docs/data-model.md` is the authority on product data, states, and persistence.
  `apps/workspace/docs/adr` records only accepted decisions.
- Maintainer release steps belong in `docs/releases/cli.md`, not in a user README. A package
  README states the package's responsibilities, non-responsibilities, and consumers.
- Describe only what exists. Never write an unbuilt capability as current fact.
- Update `DREAMNUM.md` in the same change when repository responsibilities, external applications,
  cross-repository dependencies, public contracts, deployment handoffs, or data classification
  change. Otherwise leave it alone.

## Releases and deployment

Do not publish artifacts, push images, or trigger deployments unless the user asks. A tag push
starts nothing. A source manifest's `private` flag does not mean the application is unreleased.
`univer-workspace-cli` ships through the packaging workflow. `docs/releases/cli.md` describes CLI release and promotion, and
`apps/workspace/README.md` describes deployment. `scripts/release/policy.mjs` enforces the release
channels and version formats.

## Commits and pull requests

- PR titles and commit messages follow Conventional Commits, `type(scope): description`. Mark a
  breaking change with `!` or a `BREAKING CHANGE:` footer. The repository takes merge commit
  titles from the PR title.
- When later PRs build on earlier ones, organize them as a GitHub stacked PR chain with `gh stack`
  (`gh extension install github/gh-stack`). Each layer is one branch whose PR targets the layer
  below, and each layer is reviewed on its own. Independent PRs each branch from `main`. Rebase on
  the latest `main` before you open a stack.
- Create a stack with `gh stack init`, `gh stack add`, and `gh stack submit --open`, or connect
  existing PRs with `gh stack link <lower> <upper>`. After you change a lower layer, run
  `gh stack rebase --upstack` and `gh stack push`.
- Land a stack with `gh stack merge <top-pr> --merge -y`. Use merge commits only, because squash
  and rebase rewrite lower layers and create duplicate changes and false conflicts above them.
  After only some lower layers land, run `gh stack sync`. To move upper layers by hand, run
  `git rebase --onto origin/main <old-lower-head>`, and never merge `main` into them.
- `git push --force-with-lease` on your own stack branches is normal. If a permission check blocks
  it, stop and ask the user. Do not switch to merging instead.
