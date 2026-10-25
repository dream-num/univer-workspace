# Univer Workspace CLI

An agent-ready CLI for automating remote Univer Workspace, powered by the
[Univer SDK](https://docs.univer.ai/).

`uvw` (npm package `univer-workspace-cli`) gives AI agents a complete environment for creating, editing, validating,
rendering, and reviewing business content. It brings Sheets, Docs, Slides, Bases, and Boards
together with Workspace collaboration, content exchange, and verifiable output in one installable
tool.

It is also a comprehensive Univer SDK use case: a working example of how Univer's document model,
Facade APIs, collaboration, rendering, and conversion capabilities compose into an agent product.

## Built for agents

```text
Human intent
    ↓
AI agent + version-matched guidance
    ↓
Univer Workspace CLI
    ↓
Univer SDK + Workspace
    ↓
Verified, reviewable content
```

People define the outcome and review the result. Agents use the CLI to manage the Workspace task,
author content through the Univer Facade API, verify both data and rendering, and return a direct
review handoff.

The installed package supplies the operational contract an agent needs:

- Version-matched Skills for Core, Sheet, Doc, Slide, Base, Board, Blob, HTML Views, embeds, and cross-Unit formulas
- Structured JSON output for planning, execution, and verification
- Offline Facade API and SVG resource discovery
- CLI help aligned with the installed SDK and command surface

Read a Skill with `uvw skills get <name>`. It lists bundled reference
paths and how to read them. Read one document with
`uvw skills read <name> <path>`. Only listed reference and template
paths are accepted. `skills get <name> --full` prints the bundled references and
templates at once.

## SDK capabilities in one CLI

| Agent outcome            | Univer capabilities composed                                                                             |
| ------------------------ | -------------------------------------------------------------------------------------------------------- |
| Author rich content      | Facade APIs across Sheet, Doc, Slide, Base, and Board                                                    |
| Work in isolation        | Personal and Team Spaces, task Worktrees, stable Resource and Unit identities                            |
| Verify results           | Structured inspection, layout capture, PNG rendering, and PDF printing                                   |
| Exchange business files  | Office import and export with original-file preservation                                                 |
| Generate content         | Markdown/Typst-to-Doc and SVG-to-editable-Slide compilation                                              |
| Compose across Units     | Embedded Units and cross-Unit formulas backed by Workspace identities                                    |
| Take requests from teams | Team Space Issues (`uvw issue`): read the brief and its discussion, comment, label, and close            |
| Deliver for review       | Pull requests (`uvw pr`, Worktrees): revisions, ready state, direct review links, and controlled merging |

Together, these capabilities show the range of products and workflows that can be built with the
Univer SDK.

## Install

To use Workspace with an existing agent such as Claude, Codex, or Kimi Work, install the CLI and [Workspace CLI Skill](../../skills/univer-workspace-cli/SKILL.md) in the environment where the agent runs:

```bash
npm install --global univer-workspace-cli@latest
npx skills add dream-num/univer-workspace --skill univer-workspace-cli -g
```

The package installs two names for one program: `uvw` and `univer-workspace-cli`. Do not install the
unrelated npm packages `uvw` or `uvw-cli`. After upgrading from an older version, re-run the
`npx skills add` command once so the installed Skill matches the new command names.

The default Workspace service is `https://space.univer.ai/`.
Point the CLI at your own Workspace deployment with
`uvw config set workspace.origin <origin>`. Give the
agent access to the executable and that Workspace; the bundled guidance supplies the
version-correct workflow.

## Login

The default login does not ask the agent for a Workspace password:

```bash
uvw auth login
```

The command prints a short-lived Workspace URL and verification code, saves the pending request
locally, and exits immediately. The agent must send the URL and code to the user, then stop and wait
for the user's reply—it must not poll while approval is pending. Open that URL in your own browser,
sign in if necessary, and confirm the matching code. Existing browser sessions and all browser
sign-in methods—including GitHub and Discord—work with this flow.

Only after the user confirms approval, complete the one-time exchange:

```bash
uvw auth login --complete
```

`--complete` checks once and exits; it does not wait or poll. Approval creates a separate CLI session
without copying the browser cookie or an OAuth access token through the agent.

For compatibility, a user at an interactive terminal can still sign in directly with a Workspace
username and password:

```bash
uvw auth login --username <name>
```

`--password-stdin` remains available for controlled automation that already owns a password secret.

## Commands

Commands follow the GitHub CLI's naming. A repository is a Space, named `<owner>/<slug>`
(`<username>/personal` is your Personal Space); pass it with `-R` or set `UVW_REPO`. A pull request is a
Worktree; `uvw worktree ...` is the same command group under its product name.

| Group   | Commands                                                                                                                                                                                                                                                |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Core    | `auth login/logout/status`, `repo list/view/create/edit/rename`, `issue list/view/create/edit/close/reopen/comment`, `label list/create/edit/delete`, `pr list/view/create/edit/ready/merge/discard` (alias: `worktree`), `search issues/prs`, `browse` |
| Content | `space browse/find/node`, `unit`, `execute`, `inspect`, `screenshot`, `lint`, `print-pdf`, `import`, `export`, `compile-markdown`, `export-markdown`, `compile-typst`, `compile-svg`, `blob`, `asset`, `html-view`                                      |
| Setup   | `config`, `daemon`, `skills`, `resources`, `api`                                                                                                                                                                                                        |

`--json [fields]` prints the bare object or array, optionally narrowed to the listed fields. Exit code 4
means sign-in is required. `pr discard` is irreversible; there is no `pr close` or `pr reopen`
(use `pr ready --undo` to return to draft). Content commands take `--worktree <id>`, the `id` from
`uvw pr view <n> -R <repo> --json id`.

## Modern Docs from Markdown

`compile-markdown` uses the shared Univer AI SDK compiler to create editable Modern Docs.
Standard Markdown/GFM covers headings, rich text, lists, quotes, code, images, and tables.
Univer directives add callouts, columns, native charts/shapes, inline styles, and supported ranges.
Body spacing and heading styles inherit the Univer SDK defaults; agents do not need to specify typography.
Callouts also inherit native theme colors. Omit `tone` and color overrides for normal generation;
use an explicit `tone` only when the user requests a custom semantic color:

```markdown
:::callout{#notice}
Review the launch checklist before publishing.
:::
```

Local resource paths resolve relative to the Markdown file and must remain inside its source directory.

```bash
uvw compile-markdown report.md --out review/doc.js --json
uvw compile-markdown report.md --apply --worktree <id> --space <space-id> \
  --source-map-out review/source-map.json --json
uvw export-markdown --worktree <id> --unit <doc-id> \
  --source-map review/source-map.json --blocks intro --out review/update.md \
  --source-map-out review/current-map.json --json
uvw compile-markdown review/update.md --apply --worktree <id> --unit <doc-id> \
  --source-map review/current-map.json --blocks intro \
  --source-map-out review/current-map.json --json
```

For updates, assign explicit IDs in the source and retain the materialized source map. The replacement
source must retain the selected top-level IDs; a full source file is also accepted, and only selected
blocks are applied. Invalid native mappings or block boundaries fail before content is changed.
The exported revision is read metadata, not a required update argument.
Save each successful execution map for the next edit. Direct native edits remain authoritative;
Markdown is not automatically synchronized back from the document. Worktree review and merge stay explicit.

To edit a generated block after native document changes, first use `export-markdown`. It runs a
read-only shared SDK program against the current native Doc, writes the selected blocks and local
resource sidecars, and returns the authoritative revision from that same runtime read. Edit the
exported Markdown and pass its refreshed source map and selected block IDs to `compile-markdown`.
Current Workspace image assets resolve through the authenticated Worktree Asset API.
The source-map JSON includes `{ unitId, revision, sourceMap }`; it is accepted by `--source-map`.
Exports that cannot represent selected native content without loss fail with diagnostics. Unselected
blocks remain outside the replacement. Native block IDs and boundaries are checked before update.

## License policy

Set `UNIVER_LICENSE` to a non-empty value to override the bundled runtime license.

## Project links

- [Univer Workspace repository](https://github.com/dream-num/univer-workspace)
- [Univer SDK documentation](https://docs.univer.ai/)
- [Univer Office SDK documentation](https://office.univer.ai/)
- [Univer on GitHub](https://github.com/dream-num/univer)
- [Workspace issue tracker](https://github.com/dream-num/univer-workspace/issues)
- [Univer website](https://univer.ai/)

## Maintainer release workflow

Creating or pushing a tag never starts CI or publishes a package. In GitHub
Actions, manually run **Build and release CLI (manual)**:

- Stable: select the existing `vX.Y.Z` tag as the workflow ref
  and enter the matching `X.Y.Z` version. The commit must be contained in `main`.
- Insiders: select `main` and enter `X.Y.Z-insider.<suffix>`.

The old `release-cli.yml` workflow is disabled in repository Actions settings;
keep it disabled so historical tags cannot reactivate its tag-push release path.
The replacement workflow is `release-cli-manual.yml`.

The channel is derived from the version; there is no channel input.
`dry_run` defaults to true. Explicitly set `dry_run=false` to publish the
verified tarball to insider-npm. The source manifest remains `0.0.0`; public npm promotion
and Workspace deployment are separate operations.
