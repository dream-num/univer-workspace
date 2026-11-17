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
Password login creates an Agent session on servers that support the CLI password route. Older servers
use the legacy password route when the CLI route returns HTTP 404.

### Continue as a guest agent

An agent can work without any user account:

```bash
uvw auth guest [--label <name>]
```

The command creates a new guest agent with its own Personal Space, stores its session in the same
session file as a login, and prints the agent's username and its repository `<username>/personal`.
The agent creates files there with the usual commands, merges its pull request, and shares the result
with `uvw share`. A guest agent cannot create or join a Team Space, and it keeps at most 20 files of
at most 10 MiB each.

`uvw auth guest` refuses while a session is stored for the Workspace origin. Run `uvw auth logout`
first. A command that needs a session never creates a guest agent on its own. It exits with code 4
and names `uvw auth login` and `uvw auth guest`.

A guest session lasts as long as a Workspace session, 7 days by default, and use does not extend it.
After the session ends, or after `uvw auth logout`, the CLI cannot sign in to the same agent again.
`uvw auth guest` then creates a new agent, and nobody but a person who claimed it can change the old
agent's files. Links that the old agent shared keep working until the old agent expires, 30 days
after it was last used or one of its links was last opened. A claimed agent never expires.

## Share a file by link

```bash
uvw share <file-link-or-node-id>                       # read the current setting
uvw share <file-link-or-node-id> --link viewer         # anyone who has the link can read
uvw share <file-link-or-node-id> --link editor         # signed-in people can also edit
uvw share <file-link-or-node-id> --link off            # stop sharing
```

`uvw share` reads or sets Link Sharing for a file in a Personal Space, and prints the file link.
Share a file after its pull request is merged. Only the owner of the file can use the command.
`--json` prints `url`, `name`, `link`, and `owner`. When the owner is an unclaimed agent, it also
prints `expiresAt`. The link stops working on that date unless the agent is used or the link is
opened before then. It also prints `claimUrl` and `claimHint`: a link that lets a person keep the
agent's files, and a sentence telling the agent to give it to the user.

```bash
uvw claim [--json]
```

`uvw claim` prints a new claim link for the signed-in guest agent, with `claimUrl` and `expiresAt` in
`--json`. A person who signs in and opens it within 10 minutes becomes the agent's owner: the agent
stops expiring, its links keep working, and the person manages its files in the browser. The agent
gets no access to the person's files. Each link works once. A claimed agent or a person gets an
error.

To read a shared file, pass its link as the Unit. `outline`, `read`, `find`, `inspect`, and
`screenshot` accept a file link as `--unit` and resolve it to the Unit, for any file the session can
read:

```bash
uvw outline --unit <file-link> --trunk
uvw read <range> --unit <file-link> --trunk
```

## Commands

Commands follow the GitHub CLI's naming. A repository is a Space, named `<owner>/<slug>`
(`<username>/personal` is your Personal Space); pass it with `-R` or set `UVW_REPO`. A pull request is a
Worktree; `uvw worktree ...` is the same command group under its product name.
Repository references also accept a Space ID, a Workspace URL, or a bare slug that
uniquely matches `uvw repo list`. Unknown or ambiguous slugs return
`workspace-argument-invalid` with an owner/slug hint and matching candidates.

| Group   | Commands                                                                                                                                                                                                                                                |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Core    | `auth login/guest/logout/status`, `repo list/view/create/edit/rename`, `issue list/view/create/edit/close/reopen/comment`, `label list/create/edit/delete`, `pr list/view/create/edit/ready/merge/discard` (alias: `worktree`), `search issues/prs`, `browse`, `share` |
| Content | `space browse/find/node`, `unit`, `execute`, `outline`, `read`, `find` (Sheet only), `inspect`, `screenshot`, `lint`, `print-pdf`, `import`, `export`, `compile-markdown`, `export-markdown`, `compile-typst`, `compile-svg`, `blob`, `asset`, `html-view`                                      |
| Setup   | `config`, `daemon`, `skills`, `resources`, `api`                                                                                                                                                                                                        |

`--json [fields]` prints the bare object or array, optionally narrowed to the listed fields. Exit code 4
means sign-in is required. `pr discard` is irreversible; there is no `pr close` or `pr reopen`
(use `pr ready --undo` to return to draft). Content commands take `--worktree <id>`, the `id` from
`uvw pr view <n> -R <repo> --json id`. A person who claimed an agent works on the agent's pull requests with
`-R <agent>/personal`: `pr list`, `view`, `ready` (and `--undo`), `merge` and `discard` work there, and the
server records the person as the one who acted. Editing an agent's pull request, or opening one in its Space,
is refused.

A merge decides on the revision you reviewed: the title, the summary and the drafts of its files, not trunk edits
made since. When you can review the pull request, `uvw pr view <n> -R <repo>` shows it, as does `--json revision`,
and `uvw pr merge <n> -R <repo> --revision <revision>` merges only if the pull request is still at that revision.
Merging someone else's pull request, such as a claimed agent's or a Team member's, requires `--revision`;
without it, or after the pull request changed, the merge is refused and nothing is merged. View it again before
you decide. Merging your own pull request does not need `--revision`. A Team Owner or Admin cannot review or merge a
private Team pull request someone else created until `uvw pr edit <n> -R <repo> --visibility space` shows it to the
Team.

Issue and pull request JSON include `createdVia` when the server provides it, with values `browser`,
`agent`, or `unknown`. Select it with `uvw issue view <n> -R <repo> --json createdVia` or
`uvw pr view <n> -R <repo> --json createdVia`. An Issue without attribution returns `unknown`;
a pull request without attribution omits the field.

Configuration and daemon lifecycle commands start without loading Office or rendering capabilities. The daemon
loads content capabilities on its first content request. Concurrent first requests share one runtime
initialization, and shutdown waits for that initialization before closing it.

## Board layout lint

`lint` checks Slide and Board Units without changing content. Select `--trunk` or an existing
`--worktree <id>`; inspection does not require creating a draft. For a Board, `--mode model` runs without a
browser; `--mode rendered` checks final geometry and `--mode both` (the default) retains both analyses.
An incomplete report means some geometry could not be established and must not be treated as a clean pass.
Rendered checks require the version-matched render page and a supported browser.
For a Board, `--plan-labels` with `--mode rendered` or `--mode both` adds read-only measured label plans in
`analyses[].labelPlan`. Review a ready plan for `FBoard.getActivePageId()`, apply it with `FBoard.applyLayoutPlan`, then lint
again. Stale plans are rejected and must be recaptured; model-only checks cannot produce measured label plans.
Board rendered/both `--plan-ports` returns a read-only native automatic port-order plan in
`analyses[].portPlan`. Missing or incomplete planning leaves coverage incomplete. Apply one ready plan to
the same Board/page, then lint a fresh snapshot before using another plan; original findings remain visible.
Board rendered/both lint can opt into `--maximum-automatic-label-distance 12` (finite non-negative Board
units, including zero). Missing native evidence is incomplete; exceeded limits are errors, so either exits 2.
The sampled, marker-trimmed stroke-centerline metric excludes fixed/authored and endpoint-role labels;
it is not raster ink and never moves labels.
For a new diagram or an explicit repair, use rendered measurements before growing shapes or table frames.
Rendered `analyses[].rendered.elementTextLayouts` also reports native local available/content sizes for shape text
without overflow. Use ready metrics to fit generated heading frames explicitly, then remeasure and verify history;
pending fonts remain unresolved and inspection never resizes content.
Generated lane capacity can be enlarged with the native lane API before replanning; authored capacities and fixed
or locked owners stay unchanged. Verify each write with Undo/Redo and roll back capacity and size changes if the
fresh plan is incomplete. Screenshot review remains a separate step.
Board errors or incomplete coverage exit with code 2; with `--json`, stderr contains one error object whose
`error.details.report` retains the full report, and stdout stays empty.

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

Set `UNIVER_LICENSE` to a non-empty value to override the bundled runtime license. Office
import and export also verify the license with `UNIVER_LICENSE_KEY`; override both together.

## Debugging

Set `UNIVER_DEBUG=1` to print the stack trace of an unexpected failure instead of its message.

## Project links

- [Univer Workspace repository](https://github.com/dream-num/univer-workspace)
- [Univer SDK documentation](https://docs.univer.ai/)
- [Univer Server SDK documentation](https://docs.univer.ai/server)
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
