# Univer Workspace CLI

This file applies to `apps/cli/**`. Installation, login, and user-facing capabilities
stay in the `README.md` beside this file. The sections below are the implementation
boundaries moved out of that README. Keep these behaviors when changing the CLI.

## CLI and Client Core

The CLI composes storage-neutral authentication protocols, Space/Node access, local
Node-hosted Blob/Asset transfer, runtime target and Snapshot reads, and referenced-Unit
policy from the private `@univerjs/univer-workspace-client-core` package. Packaging
bundles that code into the self-contained CLI artifact. Users do not install Client Core
separately.

The CLI owns:

- Origin configuration, Session files, and password input
- Daemon socket/control and process signals
- The packaged worker entry
- Browser binary install, probe, and resolve
- Command presentation, including Office, Typst, and SVG
- Local output writes, daemon transport, and render-page artifact copy
- Native binding delivery in the installable artifact

Client Core owns:

- Asset image resolution, render Unit assembly, screenshot capture, PNG output, PDF printing, and Slide layout lint
- The render-page source, shared worker composition, and the runtime pool
- Content execution, embedded-image externalization, and the changeset commit workflow
- Node-hosted Office exchange, and Typst compile, materialize, and apply
- SVG source/asset compilation, text measurement, Slide page wrapping, and apply orchestration

## Skills output

`skills get` lists references in JSON as `data[].resources` entries with `path` and
`readCommand`. `skills read --json` returns `data: { name, path, content }`. Only listed
reference and template paths are accepted. `skills get <name> --full` prints all bundled
references and templates at once.

## Render copy

Worktree screenshots resolve UUID-backed images through the Workspace Asset sign/content
flow before rendering. Host, formula-reference, and embedded Unit data are rewritten only
in the render copy, including image references serialized inside `resources[].data`.

## PDF printing

`print-pdf` prints a Sheet, Doc, Slide, or Board from an explicit trunk or Worktree scope.
Base Units are not printable, and an existing output file is never replaced:

```bash
univer-workspace-cli print-pdf ./reports/book.pdf --trunk --unit <unit-id>
univer-workspace-cli print-pdf ./reports/review.pdf --worktree <worktree-id> --unit <unit-id>
```

## Runtime license

The CLI bundles the same application-owned runtime development license as the Workspace
browser. Both copies are rotated every 90 days. This credential is not the repository
software license. Set `UNIVER_LICENSE` to a non-empty value to override the bundled
credential.
