# Space plugin tests

This directory holds the Space plugin's tests and manual acceptance scripts.
The build and release chain stays in `../scripts`; everything here is test-only
and never ships in the packaged plugin.

## Layout

| Directory | Contents | How to run |
| --- | --- | --- |
| `test/*.test.mjs` | Unit tests. Synthetic fixtures and loopback HTTP servers only; no real external Server or Host. | `npm test` |
| `test/browser/` | Browser regressions for real React components and the real SDK preview. | `node test/browser/<script>.mjs` |
| `test/live/auth/` | Login, OAuth protocol and OAuth lifecycle checks. | `node test/live/auth/<script>.mjs` |
| `test/live/host/` | Host connection, Host lifecycle, clean install and tool binding checks. | `node test/live/host/<script>.mjs` |
| `test/live/editor/` | Creation, CRUD, editor assembly/recovery/regression, HTML and read-only checks. | `node test/live/editor/<script>.mjs` |
| `test/live/navigation/` | Navigation lifecycle, navigation theme and recovery checks. | `node test/live/navigation/<script>.mjs` |
| `test/live/collaboration/` | Collaboration, human collaboration and sharing checks. | `node test/live/collaboration/<script>.mjs` |
| `test/helpers/` | Shared helpers for the scripts above (`host-connection.mjs`, `evidence-output.mjs`). | Imported, not run directly. |
| `test/fixtures/` | Seed scripts and browser harness fixtures. | Seed: `npm run seed:live`, `npm run seed:product`. |

## `npm test`

`npm test` runs only the unit tests in `test/*.test.mjs`. They use synthetic
fixtures and loopback HTTP servers, and do not depend on a real external Server
or Host. The command does not build the plugin and does not start a browser.

## Browser scripts

The scripts in `test/browser/` need a built plugin and a browser. Build first
with `npm run build`, then supply `SPACE_PLAYWRIGHT_MODULE`, optionally
`SPACE_BROWSER_EXECUTABLE`, and `SPACE_EVIDENCE_DIR` outside the repository.
Run them from `apps/space-plugin`; they read `src/` and `lib/` relative to the
current working directory.

## Live scripts

The scripts in `test/live/` need an isolated Server, an isolated DSH Host and
seeded fixtures. They may write data, install and uninstall the plugin bundle,
and can incur model usage cost. **Do not run them against a production
environment.** Keep credentials and generated evidence outside the repository.

Keeping a live script here records a manual scenario, not a passing result. A
script's presence says nothing about whether it currently passes. The scripts
were reorganized in this change and were not executed against a live
Server or Host as part of it.

## Coverage notice

The retired one-off acceptance scripts were removed from this package. Their
scenarios are no longer claimed by any script here: full end-to-end context and
navigation coverage across all file types is not asserted by the remaining
scripts.
