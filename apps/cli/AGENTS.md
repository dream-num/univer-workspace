# Univer Workspace CLI

`README.md` beside this file is the user contract for commands, flags, JSON output, exit codes,
and license overrides. Keep it in sync with any behavior change.

## CLI and Client Core

The CLI is one host of `@univerjs/univer-workspace-client-core`. Put a capability in Client Core
when another Node-hosted client such as the MCP gateway could use it. The CLI keeps only these
concerns:

- Origin configuration, session files, and password input
- The daemon socket, daemon control, and process signals
- The packaged worker entry and native binding delivery
- Browser binary install, probe, and resolve
- Command presentation, local output writes, and the render-page artifact copy

`packages/client-core/README.md` lists what Client Core owns.

## Commands and startup

- Product commands (`auth`, `repo`, `issue`, `label`, `pr`/`worktree`, `search`, `browse`,
  `share`) only talk HTTP. `src/product-commands.ts` assembles them from the light
  `@univerjs/univer-workspace-client-core/product` entry, and `src/lifecycle-commands.ts` builds
  `config` and `daemon` from the shared SDK lifecycle command factory. Neither file imports the
  Client Core package root. `src/main.ts` loads `src/program.ts`, which pulls in the Univer
  runtime, only for the remaining commands. `test/uvw-commands.test.ts` checks the product command
  imports but not `src/lifecycle-commands.ts`.
- `pr` and `worktree` are built from the same handlers and must stay equivalent. The same test file
  checks this.
- The repository comes from `-R` or `UVW_REPO` only. Do not add a stored default.
- The npm package name, both bins (`uvw`, `univer-workspace-cli`), `~/.univer-workspace-cli`, the
  session file, the daemon socket and identity, and the `UNIVER_HOME`, `UNIVER_LICENSE`, and
  `UNIVER_WORKSPACE_CLI_BUILD_ID` variables keep their old names. Do not rename them.

## Content behavior

- Worktree screenshots resolve UUID-backed images through the Workspace Asset sign and content
  flow. Host, formula-reference, and embedded Unit data are rewritten only in the render copy,
  including image references inside `resources[].data`, never in the source Unit.
- `print-pdf` prints a Sheet, Doc, Slide, or Board from an explicit trunk or Worktree scope. Base
  Units are not printable, and an existing output file is never replaced.

## Packaging

- `package.json` keeps the source version `0.0.0`. Stable versions come only from `vX.Y.Z` tags
  and insiders versions from the release workflow input. Releases never rewrite the manifest.
- The packaging workflow builds Client Core first and inlines its runtime code into the
  self-contained artifact. Client Core is never an install-time dependency.
- The artifact holds only the code, resources, and version-matched Skills it needs at runtime,
  and it never depends on the current checkout. The packaging script reads native binding
  versions from the wrapper package manifests. `scripts/package-artifact.test.mjs` checks these
  rules.
