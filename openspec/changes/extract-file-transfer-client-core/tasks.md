> Implementation root: `~/github.com/dream-num/univer-workspace`. Apply only after `extract-space-node-client-core` is complete. Do not create product code in this planning repository.

## 1. Move Node file safety

- [x] 1.1 Add the existing source inspection, stable-size stream, response metadata and atomic download-target code to `@univerjs/univer-workspace-client-core` public exports without adding a filesystem abstraction; migrate `files.test.ts` cases and verify regular-file rejection, source size change, `0600` output, race-safe non-force commit, explicit force replacement, exact size and temp cleanup with `pnpm --filter @univerjs/univer-workspace-client-core test`.

## 2. Move Blob transfer

- [x] 2.1 Move Blob metadata parsing and the complete reserve→PUT→verify→complete→read-back workflow into Client Core, adapting only the agreed authenticated HTTP provider and reusing Change 1 Space/Node exports; verify stable idempotency identity, attempt counts, no replay after confirmed state, terminal/result-unknown errors, strict Operation/Upload/Resource matching and exact download metadata in Client Core tests.

## 3. Move Asset transfer

- [x] 3.1 Move the Asset sign/content resolver and download workflow into Client Core, retain the resolver as a public export for content consumers, and verify invalid envelopes/URLs, cross-origin cookie isolation, missing metadata, preflight output-exists behavior and exact ETag/byte results with `pnpm --filter @univerjs/univer-workspace-client-core test`.

## 4. Reconnect Workspace CLI

- [x] 4.1 Switch CLI composition and Blob/Asset Commander typing to package exports, update `features/content/source.ts` to import the shared Asset resolver and content metadata helper, remove the obsolete CLI file/Blob/Asset owner modules, and verify unchanged option mapping, JSON/text results, error codes, `--force` behavior and image Asset resolution with the CLI command-contract and content-source Vitest cases.

## 5. Preserve package ownership and delivery

- [x] 5.1 Update the Client Core responsibility README, affected CLI/repository responsibility docs and dependency graph only where facts changed; build Client Core before CLI bundling and verify `pnpm --filter @univerjs/univer-workspace-client-core typecheck`, `pnpm --filter @univerjs/univer-workspace-client-core build`, `pnpm --filter univer-workspace-cli typecheck`, `pnpm package:workspace-cli` and `pnpm --filter univer-workspace-cli package:smoke` succeed without a workspace bare import or checkout dependency.

## 6. Run the compatibility gate

- [x] 6.1 From a clean target-repository build state, run `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm package:workspace-cli`, `pnpm --filter univer-workspace-cli package:smoke` and `git diff --check`; record that Blob/Asset Server contracts, Workspace CLI commands, Session timing, file safety, recovery semantics and installed artifact behavior remain unchanged.
