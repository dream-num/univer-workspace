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

A CLI session ends when its session lifetime, 7 days by default, runs out. When the CLI uses it after
half of that lifetime has passed, the server renews it to a full lifetime, so a CLI in regular use
stays signed in. A CLI left unused therefore ends after 3.5 to 7 days by default, and signing in again
needs a new browser approval. Changing the account password in the browser ends all of that
account's CLI sessions.

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
with `uvw share <file> --link viewer`. Once a person claims it, the agent can also leave a ready pull
request for that person to review and merge; nothing enforces either choice. Before it is claimed, a guest
agent cannot join a Team Space, add members to one or make a repository public. It can create up to 3 Team
Spaces of its own, and keeps at most 20 files across its repositories, of at most 10 MiB each.

`uvw auth guest` refuses while a session is stored for the Workspace origin. Run `uvw auth logout`
first. A command that needs a session never creates a guest agent on its own. It exits with code 4
and names `uvw auth login` and `uvw auth guest`.

A guest session renews like a login session: it lasts 7 days by default, and a guest agent in regular
use stays signed in. Left unused, it ends after 3.5 to 7 days by default. After the session ends, or
after `uvw auth logout`, the CLI cannot sign in to the same agent again.
`uvw auth guest` then creates a new agent, and nobody but a person who claimed it can change the old
agent's files. Links that the old agent shared keep working until the old agent expires, 30 days
after it was last used or one of its links was last opened. A claimed agent never expires.

## Share a file by link

```bash
uvw share <file-link-or-node-id>                       # read the current setting
uvw share <file-link-or-node-id> --link viewer         # anyone who has the link can read
uvw share <file-link-or-node-id> --link editor         # signed-in people and claimed agents can also edit
uvw share <file-link-or-node-id> --link off            # stop sharing
```

`uvw share` reads or sets Link Sharing for a file in a Personal Space, and prints the file link.
Share a file after its pull request is merged. Only the owner of the file can use the command.
`--json` prints `url`, `name`, `link`, `owner`, and `access`, which says who can open the link. A
folder's link opens everything in it. While Link Sharing is off, `access` also gives the command that
lets anyone with the link read the file; for a person's session, it says to run it only if the user
asks. When the owner is an unclaimed agent, the output also has `expiresAt`. The link stops working
on that date unless the agent is used or the link is opened before then. It also has `claimHint`, a
sentence telling the agent to make a claim link with `uvw claim` and give it to the user so they can
keep its files. A file in a Team Space has no Link Sharing, so the command exits 1 with
`workspace-argument-invalid`, names the repository, and says how to let a person open the file. A
guest agent is told to make a claim link with `uvw claim` and give it to the user, because claiming
lets the user open the agent's repositories. Anyone else is pointed to `uvw repo member add` or
`uvw repo edit --visibility public`. `uvw share` never makes a claim code, so running it again never
ends a claim link the agent already gave.

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
| Core    | `auth login/guest/logout/status`, `repo list/view/create/edit/rename`, `repo member list/add/edit/remove`, `fork create/list/view/delete`, `issue list/view/create/edit/close/reopen/comment/submit/accept/send-back`, `label list/create/edit/delete`, `pr list/view/create/edit/ready/check/merge/discard` (alias: `worktree`), `search issues/prs`, `browse`, `share` |
| Content | `space browse/find/node`, `unit`, `execute`, `outline`, `read`, `find` (Sheet only), `inspect`, `screenshot`, `lint`, `print-pdf`, `import`, `export`, `compile-markdown`, `export-markdown`, `compile-typst`, `compile-svg`, `blob`, `asset`, `html-view`                                      |
| Setup   | `config`, `daemon`, `skills`, `resources`, `api`                                                                                                                                                                                                        |

`--json [fields]` prints the bare object or array, optionally narrowed to the listed fields. Exit code 4
means sign-in is required. `pr discard` is irreversible; there is no `pr close` or `pr reopen`
(use `pr ready --undo` to return to draft). Content commands take `--worktree <id>`, the `id` from
`uvw pr view <n> -R <repo> --json id`. A person who claimed an agent works on the agent's pull requests with
`-R <agent>/personal`: `pr list`, `view`, `ready` (and `--undo`), `merge` and `discard` work there, and the
server records the person as the one who acted. Editing an agent's pull request, or opening one in its Space,
is refused. A pull request has one author, and only the author edits it. `pr merge` needs edit access to every
file or folder the pull request changes. With that access the author can merge it, the person who claimed the
authoring agent can, and so can the Owner, Admins and Editors of a Team Space once the pull request is visible to
the Space. A member with read access only can still `pr create` in a Team Space, change the pull request and mark
it `pr ready`, which makes it visible to the Space. `pr create --issue <n>` and `pr edit <pr> --issue <n>` link a Team
pull request to the Issue `#n` of its repository that it serves, if you may change its title and body and can read the
repository. `pr view` shows that Issue, and `issue view` lists the linked pull requests.
`pr merge` refuses a pull request that still changes a file in Trash or permanently deleted, with `FILES_IN_TRASH`.
Its author runs `pr edit <pr> --leave-out-trashed`, which leaves those files as they are and keeps a ready pull request
ready, then merges the other files. In a repository that requires checks, report them again first.
The Owner and Admins get an error naming the author, and the
person who claimed an agent author, when they try to merge someone else's private pull request. Anyone else who
lacks edit access gets an error saying so. A merge that stopped partway leaves the
pull request `merging`, or `merged` before the server finished it; running `pr merge` again finishes it, for the
person who started it, or anyone who may merge it. Once a merge has finished, anyone
else who runs `pr merge` gets `workspace-lifecycle-invalid` saying it is already merged.
`uvw search prs --reviewable` lists, across repositories, the ready Team pull requests that others wrote and you may merge.
Pull request JSON carries `capabilities`, what you may do with it now, such as `merge`.

`uvw issue submit <n> -b <summary>` lets an assignee of an open Issue, with any role, hand the work over for acceptance.
Whoever may close the Issue, its author or a member who triages, answers with `uvw issue accept <n>`, which closes it as
completed, or `uvw issue send-back <n> -b <reason>`, after which an assignee submits again. `--body-file -` reads the body
from stdin. Repeating the latest verdict with the same body changes nothing. `issue view` shows the latest verdict as
`acceptance`, and `uvw search issues --acceptance submitted|sent_back` finds Issues by it.
The owner or an admin of a repository can turn on an acceptance deadline with `uvw repo edit --accept-after-hours 72`
(1 to 720 hours, `off` turns it off). Then a submitted Issue that nobody sends back in time is accepted and closed as
completed by no one: `issue view` prints when that will happen while it waits and `acceptance: accepted by deadline`
after, and `repo view` prints the setting. The clock restarts when the Issue is reopened. Turning the deadline on or
lowering it accepts every submitted Issue already past the new deadline within a minute.

Issue and pull request JSON include `createdVia` when the server provides it, with values `browser`,
`agent`, or `unknown`. Select it with `uvw issue view <n> -R <repo> --json createdVia` or
`uvw pr view <n> -R <repo> --json createdVia`. An Issue without attribution returns `unknown`;
a pull request without attribution omits the field.

While a pull request is draft or ready, `pr view` labels each file that came from trunk `current`, `behind by N`
or `stale`, from the server's `freshness` (also in `--json units`). `stale` means trunk is more than 100 revisions
ahead of the file or it joined more than 7 days ago. The label is advice and never blocks `pr merge`.

`uvw pr check <pr> <name> --passed|--failed [--summary <text>]` reports one check on a ready pull request. A
repository declares its checks as `## name` headings in `.agents/checks.md` on trunk. The server binds the result to
the pull request's current content, so a later trunk edit to one of its files, or a reopen that changes it, leaves the
result out of date. Reporting again on the same content replaces your result. A result counts only when its reporter
may merge the pull request. `pr view` shows how many declared checks pass, fail or are missing (`--json checks`). On
a merged pull request it shows them `at merge`, as the merge recorded them before trunk moved, or `now` for a pull
request whose merge recorded none, such as one merged before merges recorded checks (`atMerge` in `--json checks`).

`uvw pr revert <pr>`, or `uvw pr revert --issue <n>` for every merged pull request linked to an Issue, prints what a
revert would do to each file and changes nothing; `--yes` reverts. A file the merges changed goes back to its content
before the first of them, a file they added moves to Trash, and a file they removed comes back from Trash. A file
someone else edited on trunk after the merge is `blocked` and stays as it is, and the plan names who edited it; only a
person in the browser can overwrite it. Replaced pages and files cannot be reverted. Whoever may merge the pull request,
or accept the Issue, may revert it, with edit access to every file it restores. An Issue revert that reverted at least
one file records the verdict `reverted` and reopens the Issue. When nothing was reverted, `--yes` prints each file's
reason, records nothing and exits 1.

### Repository members

```bash
uvw repo member list -R <owner>/<slug>
uvw repo member add <user> --role viewer -R <owner>/<slug>     # admin, editor or viewer
uvw repo member edit <user> --role editor -R <owner>/<slug>
uvw repo member remove <user> -R <owner>/<slug>
```

These commands manage a Team repository's members, and take effect immediately. `<user>` is a username or user ID.
`add` finds the user through user search, which finds a claimed agent by its username and never an unclaimed or
stopped one; adding someone who is already a member changes their role. `edit` and `remove` take a current member,
so a stopped agent can still be removed, and a member can remove themselves. `list` prints the owner first; its
`--json` is `{ owner, members }`. `uvw repo view --json capabilities` shows `manageMembers`, which says whether you may
change members. An agent can be an admin only of a repository an agent owns, and a guest agent can neither add members
nor be one until a person claims it. Both refusals exit 1 with `AGENT_NOT_ALLOWED` and a sentence saying so.

### Forks

A fork is your own view of a Team Space, named `<your-username>/<name>`. Only you see it. It reads as the
upstream's trunk with your changes on top, and the changes become one pull request in the upstream.

A Team Space's owner and members may fork it. Anyone else may fork a public one whose `proposals` setting
admits them: `accountable` admits any person or claimed agent, `anyone` also guest agents, and `members`, the
default, no one else. Such a proposer writes only their own pull requests and holds at most 3 open ones there.
`uvw repo view --json capabilities` shows `propose`, and `repo view` prints the setting. The owner or an admin
sets it with `uvw repo create --proposals <who>` or `uvw repo edit --proposals <who>`.

```bash
uvw fork create <owner>/<slug> --name <name>
uvw space browse <you>/<name> --recursive --json
uvw execute --worktree <you>/<name> --unit <unit-id> --script edit.js
uvw fork view <you>/<name>
```

Pass the fork's name where these commands take `--worktree <id>`: `execute`, `unit list/add/create`,
`import`, `inspect`, `outline`, `read`, `find`, `screenshot`, `lint`, `print-pdf`, `html-view validate`, `blob download` and
`blob replace`. `space browse <fork>` and
`space find --space <fork>` list the upstream's files without the ones the fork removed and with the ones it
created. `unit create --space <fork>` creates the file in the upstream. `import` takes the upstream's Space ID
in `--space`. `unit create --from` and the other commands that take `--worktree` need the pull request's
Worktree ID from `uvw fork view <fork> --json worktree`.

A read through a fork shows the fork's version of a file it changed and the upstream's current trunk version of
every other file. The fork's first write opens its pull request in the upstream. A write adds an upstream file to
that pull request first, so an `execute` through a fork adds the file even when the code only reads. Writes need
the pull request to be draft: a ready one returns `FORK_WORKTREE_NOT_DRAFT` until `pr ready <n> --undo`.
`fork view` prints the pull request's number, which the `pr` commands take with `-R <upstream>`. After the pull
request is merged or discarded, the fork is `clean` again and its next write opens a new pull request.
`fork delete` deletes only the fork. Its open pull request stays in the upstream.

A fork is not a repository. Commands that take a repository, such as `repo edit`, `space node create`, `issue`
and `pr create`, refuse a fork's name and say which repository it forks.

The CLI saves no page drafts. `html-view create` publishes to a repository's trunk at once, so it refuses a fork's
name in `--space`. A page change through a fork is an HTML View draft attached to the fork's pull request, which
the MCP tool `html_view_save` saves with the fork's name as `worktree`.

`blob replace --worktree <fork>` does not change the upstream file. Its bytes become a draft in the fork's pull
request, which the merge publishes, and `blob download --worktree <fork>` returns that draft until then. Both take
only a fork's name in `--worktree`, use the upstream file's ETag, and refuse a page (`.univer.html`). A fork
replaces existing files only.

Known limit: a file the fork has not changed reads its cross-file references (formulas, embeds) from trunk.
When it references a file the fork changed, the read shows the trunk version of that file. Adding the file to
the fork with `unit add --worktree <fork>` makes its reads use the fork's changes.

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
