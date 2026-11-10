---
name: core
description: Operate Univer Workspace through MCP tools. Read first for identities, operation bindings, file transfers, per-task Worktrees, verification and review handoff.
---

# Univer Workspace MCP Core

Use this server's tools for the connected user's remote Workspace. Read this Skill
first, then the matching domain Skill. Tool schemas define arguments and results.
When authentication is required, ask the user to reconnect or re-authorize this
server in their MCP client. Never ask for a password.

## Skills and operation bindings

Load a Skill with `skills_read` and its name, or read
`skill://univer-workspace/<name>/SKILL.md`. Without arguments, `skills_read` lists
names and descriptions. With a name it returns content and resource paths. Read a
reference or template with name and resource; full includes all supplemental files.
For a truncated resource, repeat the same arguments with the returned cursor.

The shared Skills describe operations such as `api show` and `compile-svg`.
Use the table below to select the MCP tool. Worktree operations are aliases of the
corresponding pr operations. When a tool named here is not in your tool list, that
step is unavailable in this connection. Tell the user instead of guessing.
Admin tools require ?toolsets=admin or ?toolsets=all. Files tools require the files
toolset. An executor restriction can hide content tools even with all selected.

| Operation                                                                                                    | MCP tool               | Binding                                                    |
| ------------------------------------------------------------------------------------------------------------ | ---------------------- | ---------------------------------------------------------- |
| `whoami`                                                                                                     | `whoami`               | Connected identity                                         |
| `repo list`                                                                                                  | `repo_list`            | Owned or joined repositories                               |
| `repo view`                                                                                                  | `repo_view`            | Repository details, including public repositories          |
| `repo create`                                                                                                | `repo_create`          | Admin                                                      |
| `repo edit`, `repo rename`                                                                                   | `repo_edit`            | Admin; rename uses slug                                    |
| `space browse`                                                                                               | `space_browse`         | Tree discovery                                             |
| `space find`                                                                                                 | `space_find`           | Name discovery                                             |
| `space node create`, `space node rename`, `space node move`, `space node trash`                              | `space_node`           | Admin; action selects create, rename, move or trash        |
| `issue list`                                                                                                 | `issue_list`           | Team Space Issues                                          |
| `issue view`                                                                                                 | `issue_view`           | Include comments for the full discussion                   |
| `issue create`                                                                                               | `issue_create`         | Record a request                                           |
| `issue edit`                                                                                                 | `issue_edit`           | Update fields                                              |
| `issue comment`                                                                                              | `issue_comment`        | Post Markdown body                                         |
| `issue close`, `issue reopen`                                                                                | `issue_set_state`      | State closed or open                                       |
| `label list`                                                                                                 | `label_list`           | Admin                                                      |
| `label create`, `label edit`, `label delete`                                                                 | `label_write`          | Admin; action selects create, edit or delete               |
| `search issues`, `search prs`                                                                                | `search`               | Kind issues or prs                                         |
| `pr list`, `worktree list`                                                                                   | `pr_list`              | Diagnose tasks                                             |
| `pr view`, `worktree view`                                                                                   | `pr_view`              | Resolve Worktree id and state                              |
| `pr create`, `worktree create`                                                                               | `pr_create`            | Start a task                                               |
| `pr edit`, `worktree edit`                                                                                   | `pr_edit`              | Update task metadata                                       |
| `pr ready`, `worktree ready`                                                                                 | `pr_ready`             | Undo true returns ready to draft                           |
| `pr merge`, `worktree merge`                                                                                 | `pr_merge`             | Admin; explicit user request only                          |
| `pr discard`, `worktree discard`                                                                             | `pr_discard`           | Admin; irreversible, explicit user request only            |
| `browse`                                                                                                     | `browse`               | Generate a review URL                                      |
| `unit list`                                                                                                  | `unit_list`            | Staged Units in one Worktree                               |
| `unit add`                                                                                                   | `unit_add`             | Stage an existing Univer Resource                          |
| `unit create`                                                                                                | `unit_create`          | Create an empty Worktree-local Unit                        |
| `execute`                                                                                                    | `execute`              | Run Facade code and commit mutations                       |
| `inspect`                                                                                                    | `inspect`              | Read stored content                                        |
| `screenshot`                                                                                                 | `screenshot`           | Render images                                              |
| `import`                                                                                                     | `import`               | Create from uploaded Office bytes                          |
| `export`                                                                                                     | `export`               | Download Office output                                     |
| `api find`                                                                                                   | `api_find`             | Search API-name terms                                      |
| `api show`                                                                                                   | `api_show`             | Read exact signatures and examples                         |
| `skills list`, `skills get`, `skills read`                                                                   | `skills_read`          | List, get or read one resource                             |
| `resources registries`                                                                                       | `resources_registries` | Admin; SVG catalogs                                        |
| `resources find`                                                                                             | `resources_find`       | Admin; search SVG assets                                   |
| `resources export`                                                                                           | `resources_export`     | Admin; SVG text                                            |
| `blob get`                                                                                                   | `blob_get`             | Files; original-file metadata                              |
| `blob upload`                                                                                                | `blob_upload`          | Files; publish original bytes                              |
| `blob download`                                                                                              | `blob_download`        | Files; bytes and ETag                                      |
| `blob replace`                                                                                               | `blob_replace`         | Files; conditional replacement                             |
| `asset download`                                                                                             | `asset_download`       | Files; embedded image bytes                                |
| `html-view validate`                                                                                         | `html_view_validate`   | Files; validate declarative bindings                       |
| `html-view create`                                                                                           | `html_view_create`     | Files; publish HTML immediately                            |
| `compile-markdown`                                                                                           | `compile_markdown`     | Files; Markdown to Modern Doc                              |
| `export-markdown`                                                                                            | `export_markdown`      | Files; selected native blocks to Markdown                  |
| `compile-svg`                                                                                                | `compile_svg`          | Files; SVG to a Slide page                                 |
| `compile-typst`                                                                                              | `compile_typst`        | Files; Typst bundle to Doc                                 |
| `print-pdf`                                                                                                  | `print_pdf`            | Files; PDF download                                        |
| `lint`                                                                                                       | `lint`                 | Files; layout diagnostics                                  |
| `file upload create`                                                                                         | `file_upload_create`   | Reserve a byte transfer                                    |
| `job get`                                                                                                    | `job_get`              | Poll a long-running operation                              |
| `auth login`, `auth status`, `auth logout`                                                                   | unavailable            | Sign-in belongs to the MCP client; use whoami for identity |
| `config`, `daemon`, `screenshot setup`, `skills path`, `resources cache path`, `resources cache clear`, `-v` | unavailable            | Local environment management has no remote tool            |

## Concepts and identities

- A Space (repository) contains a visible tree of Nodes. A Team Space is shared;
  access follows membership and role. Its repository name is owner/slug. A Personal
  Space is the connected user's owner/personal and contains personal files.
  Repository arguments also accept Space IDs or Workspace URLs. Older Team Spaces
  without slugs use their Space ID.
- A Node is a position identified by nodeId. Every Node may have children, even a
  Resource Node. An organizational Node has resource null.
- A Resource is product content attached to a Node. A Univer Resource has kind
  univer and one Unit type, Sheet, Doc, Slide, Base or Board. Stage its resourceId.
  A Blob has kind blob, MIME, byte size and availability, with no Unit identity.
  Upload or download Blobs directly; never stage them into a Worktree.
- A Unit is the collaboration content identity addressed by unitId. Use it for
  content tools. A Worktree-local Unit is created inside a task; the server
  allocates unitId, resourceId and nodeId, and merge activates its destination.
- A Worktree (pull request) isolates one task from shared files until merge.
  A user-scoped Worktree belongs to the connected user's Personal repository and
  may stage editable files from Personal or Team Spaces. It is not a Personal
  Space. A Space-scoped Worktree belongs to one Team Space, contains only that
  Space's Units, and can be private or visible to the Space.
- Team Issues and pull requests share the Space's number sequence. Older
  Worktrees may have number null and use their id. An Issue is a discussion and
  request, not a Worktree; Personal Spaces have no Issues.

Never interchange spaceId, nodeId, resourceId, unitId, Worktree id or pull request
number. Take identities and confirmed revisions from tool results, never names.
Content tools take the Worktree id returned by `pr_view`, not its number.
Use paths and names for discovery and disambiguation only. `space_find` and
`space_browse` discover files before staging; `unit_list` lists only staged Units.
The resources operations search an SVG catalog, not Workspace files.

## Worktree rule

Start every new editable-content task in a new Worktree. `pr_list` is diagnostic,
not permission to reuse another draft because its name or Unit looks suitable.
Continue an existing Worktree only for rework of the same task, when this agent
already worked in that known Worktree or the user supplies its identity for that
rework, and its state is draft or ready. If identity is uncertain, start a new one.
Continue draft directly. Return ready to draft with `pr_ready` and undo true before
editing. Never reuse merged or discarded Worktrees; stage the current file anew.

## Manage Space Nodes

Use `space_node` to create organizational Nodes at the Space root or beneath a
stable parent nodeId. A Resource Node can be a parent when its capabilities allow
children. Use returned nodeId as the parent for later Unit creation.
Creation writes directly to the Space and cannot be undone by Worktree discard.
After an unknown result, browse the exact parent before deciding whether to retry.
Sibling names need not be unique; a same-name result is not proof of creation.
Rename and move use stable Node IDs. Choose either a parent or the current Space
root as the destination. The service reads back desired metadata after an
interrupted rename or move; if the result is still unknown, inspect the directory.
Trash recursively removes a subtree from its Space location. Only do it when the
user explicitly requests that action. Retain trashBatchId and nodeCount. Never
blindly repeat an unknown trash result. No restore or permanent Trash deletion
tool is available here.

## Work from an Issue

1. Resolve the repository with `repo_list` or `repo_view`. Read `issue_view` with
   comments enabled. The latest discussion may narrow the brief. Use `search`
   with kind issues and assignee @me to find assigned work across Team Spaces.
2. Use the Issue references' resource.id and nodeId to identify files. If a
   reference is unavailable, tell the user rather than guessing a replacement.
3. Start a new Space-scoped Worktree titled #N followed by the Issue title.
   The title ties the task to the Issue; no automatic Issue link is created.
4. Verify and hand off. Post the review URL and a concise account with
   `issue_comment`, identifying the comment as posted on the user's behalf.
5. Leave the Issue open and leave merging to the user unless explicitly asked.

Issue creation and comments are not idempotent. After an unknown write result,
read the discussion before repeating it. Labels and assignees require triage
rights; report a permission denial. Record follow-up work with `issue_create`
when appropriate without expanding the requested task.

## Start a task

For an existing file, resolve the repository, then find its Resource Node with
`space_find` or `space_browse`. Compare path, spaceId, nodeId, resourceId and Unit
type when several candidates match. Ask the user if the target remains ambiguous.
Create a new Worktree with `pr_create`, stage the exact resourceId with `unit_add`,
and confirm the returned unitId with `unit_list`.

For a Personal file choose a user-scoped Worktree. For a Team file choose a
user-scoped Worktree for a private personal task, or that Team's Space-scoped
Worktree when the task belongs to the team. Use Space visibility only when members
should see the draft.

For a new file, create the Worktree first. Use `unit_create` for an empty Unit,
`compile_markdown` to create a generated Modern Doc without a placeholder (read
the `doc` Skill), `compile_typst` for a Typst Doc, or `import` for Office content.
Choose the destination Space and stable parent nodeId deliberately. Do not add
an unrelated Unit to an existing task Worktree.

Every creating tool takes an idempotency key. Generate a new random value, such
as a UUID, for each new operation. Reuse it only to retry the same call with
identical arguments. Never derive it from names or reuse a key from earlier work.
Where a schema requires a key, supply it. Conversion keys use 16 to 200 URL-safe letters, digits,
underscores or hyphens. After an unknown content commit, read back before retrying.

## Edit one Unit

Read the `sheet`, `doc`, `slide`, `base` or `board` Skill before Facade code.
For cross-Unit content, read the Host and Source Skills, then the `embed` Skill or
`cross-unit-formula` Skill. Charts referencing another Unit use the `embed` Skill.
These topics persist stable Source unitId and load Source content on demand.
Do not stage a read-only Source merely to reference it, or resolve it by name.

Use `execute` with the explicit Worktree and Unit. Captured mutations commit as
one revision; read-only code creates none. There is no separate save operation.
`inspect` is always read-only and takes either trunk true or an explicit Worktree.
Execution injects only the selected root, workbook for Sheet, doc, presentation,
base or board. Never redeclare it. Sheet execution uses the explicit Unit's
Workbook, never an active Workbook.

Use the public Facade with the original image source. Supported BASE64 images
are automatically stored as Workspace FileIds with bytes stored separately.
Browser clients load them automatically; no manual asset upload or mutation
storage handling is needed. When readback returns a UUID and you need the original
bytes, use `asset_download` with that id and Worktree.

### Facade API lookup

Use `api_find` with API-name keywords or identifier fragments when no symbol is
known. Terms are case-insensitive and searched independently, not combined as AND
or interpreted as intent. Its optional Unit filter retains shared APIs.
Pass a found symbol directly to `api_show`. For a known class, type or exact
Class.member, use `api_show` immediately, batching known symbols. Read authoritative
signatures, documentation, referenced types and examples. Do not guess argument
shapes or enum values. Only find accepts a Unit-type filter. Follow returned
cursors when a class is truncated.

## File handling

Reserve a transfer with `file_upload_create` for the required purpose. It returns
an upload object with upload_id, upload_url and a browser page_url. The user or
agent uploads bytes to that capability URL with PUT, or the user selects them on
the upload page. These links expire in ten minutes; ready uploads remain available
for one hour after reservation. Never pass a local file path to a tool.

- `import`, `blob_upload` and `blob_replace` consume upload_id. Choose purpose
  office-import for Office input or blob for original files.
- `compile_svg` takes SVG text and optionally an assets_upload_id for a svg-assets
  ZIP. Use the page SVG as text and bundle its asset files in that ZIP.
- `compile_typst` takes bundle_upload_id for a typst-bundle ZIP with typst.json at
  its root. Include the source and supporting assets in the bundle.
- `compile_markdown` takes Markdown text and optionally assets_upload_id for a
  markdown-assets ZIP. Save its returned sourceMap for block updates and exports.
- `resources_export` returns SVG text, not files. Use that text in authored content.
- `export`, `print_pdf`, `blob_download` and `asset_download` return expiring download
  links. They last fifteen minutes. Download the bytes before expiry. To replace an
  edited original file, reserve and upload its bytes, then use `blob_replace` with
  the exact quoted ETag returned by `blob_download`.
- Short screenshots arrive as image content when they fit the synchronous image
  budget. Larger or long-running screenshot results provide download links.
  `export_markdown` returns Markdown, a refreshed sourceMap and asset download links.

For a running job, poll `job_get` until succeeded or failed. Do not treat a job
handle as completed output. Successful job results carry the original tool output;
screenshot job results carry download links. After an unknown creation result,
retry only the same operation with its original upload and idempotency key.

Read the `blob` Skill for original files and the `html-view` Skill for live HTML
backed by Sheet data. Blob publication/replacement and HTML View creation write
directly without Worktree review; apply them only to the intended destination.

## SVG resource catalog

When a Unit needs icons, logos, emoji or illustrations, use `resources_registries`,
`resources_find` and `resources_export`. Handles identify catalog assets. These
admin tools return SVG source for incorporation in the page or document.

## Verify and hand off

1. Read stored content with `inspect` or read-only `execute`.
2. Capture screenshots for Sheet layout, Doc pagination and every Slide page.
3. Mark the Worktree ready with `pr_ready`.
4. Read it with `pr_view` and confirm ready.
5. Generate the edited Unit's review URL with `browse`.
6. Return the review URL, pull request number, Worktree id and Unit id to the user.

Do not merge or discard unless explicitly requested. Discard is irreversible.
To resume same-task rework, return ready to draft with `pr_ready` and undo true.
There is no separate close or reopen tool for a pull request.
