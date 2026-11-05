# Create and edit a document

A signed-in user creates a Document, Spreadsheet, Presentation, Board, or Base from the
`New` menu, names it, edits it in the collaborative editor, and finds the edits still
there after a reload and from the CLI.

## Sub-features

- `doc-new-home` creates a file from the Home `New` card.
- `doc-new-sidebar` creates a file from the Personal Space `New` button in the sidebar.
- `doc-edit-sheet` edits Spreadsheet cells, and they persist across a reload.
- `doc-readback-cli` reads the same cells on Trunk with uvw.

## How to get to it (user POV)

- Home → `New` (`Create a document to start collaborating`) → choose a type → name → `Create`.
- Sidebar → `Personal Space` region → `New` → choose a type.
- Find it later in the sidebar under `Personal Space`, or with `uvw space find <name> --space <owner>/personal`.

## Driving it with agent-browser and uvw

Preconditions:

- Browser signed in as the baseline user (see [auth](./auth.md)), on `$ORIGIN/home`.
- No file named `Verify Budget` exists.

- **Open the New menu.** Run `agent-browser find role button click --name "New Create a document to start collaborating"`.
  A menu lists `Document`, `Spreadsheet`, `Presentation`, `Board`, `Base`, `Group`.
- **Choose and name.** Run `agent-browser find role menuitem click --name "Spreadsheet"`,
  then `agent-browser find label "Document name" fill "Verify Budget"`, then
  `agent-browser find role button click --name "Create" --exact`. The URL becomes
  `$ORIGIN/nodes/<nodeId>`, the heading reads `Verify Budget`, and the sidebar lists it.
- **Wait for the editor.** Run `agent-browser wait canvas`, then `agent-browser wait 3000`.
  The `Start`/`Insert`/`Formulas` ribbon is visible and A1 is selected.
- **Edit cells.** Run `agent-browser keyboard type "Rent"`, `agent-browser press Tab`,
  `agent-browser keyboard type "1200"`, `agent-browser press Enter`, then
  `agent-browser wait 2000` so the changeset syncs.
- **Persist.** Run `agent-browser reload`, `agent-browser wait canvas`, `agent-browser wait 4000`,
  then `agent-browser screenshot "$EVIDENCE/doc-edit-sheet-reload.png"`. A1 shows `Rent` and
  B1 shows `1200`.
- **CLI readback.** Run `$V cli doc-find space find "Verify Budget" --space "verify-$VERIFY_UVW_RUN/personal" --json`
  and take `nodes[0].resource.unitId`. Then run
  `$V cli doc-readback-cli inspect range A1:B1 --unit <unitId> --trunk --worksheet index:1`.
  Output shows `"Rent"	"1200"`.

## Gotchas

- The grid is a canvas, so DOM snapshots don't show cell values. Prove values with a
  screenshot or uvw.
- Without the `wait` after typing, a fast reload can drop the last edit before it syncs.
- On `127.0.0.1` the bundled license is valid. On any other host the editor shows license
  limitations, and that run proves nothing about editor features.
- `space find` takes `--space <owner>/<slug>`, not `-R`.
- Readback with uvw requires the browser user and the uvw user to be the same account.
  A user registered only in the browser is not signed in to uvw.
