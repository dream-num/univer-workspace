> Prerequisite: complete `extract-space-node-client-core` first. Implementation root: `~/github.com/dream-num/univer-workspace`. Do not create product code in the planning repository that contains this Change.

## 1. Add the Core authentication protocol

- [x] 1.1 Add auth types, storage-neutral password/browser-approval/`whoami`/logout protocol functions and named exports to `@univerjs/univer-workspace-client-core`; verify endpoint, Cookie extraction, User parsing, same-origin verification URL, expiry, pending and result-unknown cases with `pnpm --filter @univerjs/univer-workspace-client-core test`.

## 2. Reconnect the CLI Client Shell

- [x] 2.1 Refactor `WorkspaceAuth` to delegate protocol exchanges while retaining Config origin lookup, Session/pending file schema, `0600` atomic persistence, mutation queue, expiry cleanup, `readWorkspaceCookie()`, `configuredOrigin()` and `authenticatedHttp(role)`; verify the existing Session fixtures round-trip byte-compatible structured data and corrupt state still returns `workspace-session-corrupt`.

## 3. Preserve the authentication commands

- [x] 3.1 Keep `createAuthCommands` login/`--complete`/`whoami`/logout surface, password and TTY rules, no-poll browser instructions, JSON/text shapes and coded errors unchanged; verify with the existing command-contract and built-entrypoint authentication cases, including confirmation that output never contains the Login Session cookie or device code.

## 4. Split tests by owner

- [x] 4.1 Move pure authentication protocol assertions from `auth-transport.test.ts` into Client Core and retain CLI tests for persistence, cross-invocation approval, local-clear-on-remote-unknown and authenticated access composition; run `pnpm --filter @univerjs/univer-workspace-client-core test` and `pnpm --filter univer-workspace-cli test` with every delta-spec scenario represented by an assertion.

## 5. Preserve package and documentation contracts

- [x] 5.1 Update Client Core exports/responsibility README and applicable CLI/repository responsibility docs, then extend or reuse the installed-package fixture to exercise login start/complete, `whoami`, logout and an authenticated command outside the monorepo; verify with `pnpm package:workspace-cli` and `pnpm --filter univer-workspace-cli package:smoke` without unresolved workspace imports, source-checkout dependencies or credential disclosure.

## 6. Run the compatibility gate

- [x] 6.1 From a clean target-repository build state after Change 1, run `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm package:workspace-cli`, `pnpm --filter univer-workspace-cli package:smoke` and `git diff --check`; record that Server endpoints, CLI origin/Session format, command surface, output, errors and installed artifact remain unchanged.
