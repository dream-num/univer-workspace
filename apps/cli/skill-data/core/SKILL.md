---
name: core
description: Operate remote Workspace Univer and Blob Resources with univer-workspace-cli. Use for authentication, Space Node discovery and organization, Blob upload/download, per-task Worktree creation, existing-Univer-Resource staging, Unit authoring, verification, review handoff, rework, and export. Start every new editable-content task in a new Worktree; continue an existing Worktree only for rework on that same task.
---

# Univer Workspace CLI Core

Use `univer-workspace-cli` for remote Workspace content. If it is unavailable, stop and report that
the Workspace CLI is not installed. Do not substitute a local office writer because that bypasses
the remote Worktree and review lifecycle.

## SVG resources

When a Unit needs icons, logos, emoji, or illustrations, use the built-in SVG resource library:

```bash
univer-workspace-cli resources registries
univer-workspace-cli resources find <query> [<query>...]
univer-workspace-cli resources export <handle> [<handle>...] --out <directory>
```

## Concepts

Understand these identities before running a mutation:

- **Workspace origin**: the remote Workspace service address. It defaults to
  `https://workspace.univer.plus/`; configure another origin only when the task targets a different
  deployment.
- **Space**: the container whose visible tree is made of Nodes.
- **Personal Space**: the authenticated user's own Space. Files here are personal Workspace files.
  A Personal Space is not a Worktree and is not the same thing as `--scope user`.
- **Team Space**: a Space shared by a team. Access depends on current team membership and role.
- **Node**: one tree position addressed by `nodeId`. Every Node may have children. A pure
  organizational Node has `resource: null`; a Node with a Resource may still have children.
- **Resource**: the product content identity attached to a Node, discriminated by `kind`.
- **Univer Resource**: `kind: "univer"`, with one Sheet, Doc, Slide, Base, or Board `unitType`.
  Use its `resourceId` to add existing editable content to a Worktree.
- **Blob Resource**: `kind: "blob"`, with MIME, byte size, and availability but no `unitType` or
  `unitId`. Upload/download it directly; never add it to a Worktree.
- **Unit**: the Collaboration content identity inside one Worktree. Use its `unitId` for execute,
  inspect, screenshot, export, snapshot, and changeset operations.
- **Worktree**: one task's isolated Agent workspace and draft/review boundary. Changes remain
  isolated from the normal Space file until the Worktree is merged.
- **User-scoped Worktree**: a private Worktree owned by the authenticated user. It can contain Units
  the user may edit from Personal or Team Spaces. It is not a Personal Space.
- **Space-scoped Worktree**: a Worktree belonging to one Team Space. It can contain only Units from
  that Space and may be private or visible to that Space.
- **Worktree-local Unit**: a new Unit created inside a Worktree. The server allocates its
  `unitId`, `resourceId`, and `nodeId`; merge activates the target Node/Resource.

Never interchange `spaceId`, `nodeId`, `resourceId`, `unitId`, Worktree `id`, or display name.
Use display names and `path` only for discovery and disambiguation; use stable ids for commands.

`space browse` and `space find` discover Nodes and Resources before they enter a Worktree. `unit list` only lists
Units already staged in one explicit Worktree. The separate `resources` command is an SVG asset
catalog, not Workspace file discovery.

Filter discovery by Resource kind and, independently, Univer Unit type:

```bash
univer-workspace-cli space browse <space-id> --resource-kind blob --json
univer-workspace-cli space find <name> --space <space-id> --resource-kind univer --unit-type doc --json
univer-workspace-cli space browse <space-id> --resource-kind none --json
```

`--unit-type` may be combined only with `--resource-kind univer`. Filters change returned results,
not recursive reachability; a Blob Resource Node may still have children.

## Blob files

Use Blob when the exact original bytes must remain a Workspace file instead of becoming an editable
Univer Unit:

```bash
univer-workspace-cli blob upload \
  --file <source> --space <space-id> [--parent <node-id>] \
  [--name <node-name>] [--media-type <mime>] [--idempotency-key <key>] --json
univer-workspace-cli blob get <resource-id> --json
univer-workspace-cli blob download <output> --resource <resource-id> [--force] --json
```

`blob upload` publishes directly to the Space; no Worktree is involved and Worktree discard cannot
undo it. It reserves stable `uploadId`, `nodeId`, and `resourceId`, streams the exact bytes, then
publishes the Node. For important agent retries, provide a unique `--idempotency-key`. Reuse that
exact key only for the same source, size, Space, parent, and name after a `workspace-result-unknown`;
never change the intent while reusing the key.

`blob download` requires an explicit output path and refuses to overwrite by default. Use `--force`
only when replacing that path is intended; replacement occurs only after the complete byte stream
has been written. Blob commands never print binary bytes to stdout.

Do not confuse these workflows:

- `import --file`: convert Office content into a new editable Worktree-local Univer Unit.
- `blob upload --file`: preserve and publish the source bytes as a non-editable Blob Resource.
- `export`: convert one Worktree Unit head to an Office file.
- `blob download`: retrieve one Blob Resource without conversion.

## Manage Space Nodes

Create a root organizational Node by naming the target Space:

```bash
univer-workspace-cli space node create \
  <space-id> --name <node-name> --json
```

Create a direct child by passing the stable Node ID returned by the first command. A Resource Node
may also be the parent when its capabilities allow child creation:

```bash
univer-workspace-cli space node create \
  <space-id> --name <child-node-name> --parent <node-id> --json
```

Use that returned Node ID as `--parent <node-id>` when creating a Unit at that location. Do not
derive a parent from a display path or Node name.

Node creation is a direct Space write. It is not isolated in a Worktree, and Worktree
discard cannot undo it. The first version is non-idempotent: if the command reports
`workspace-result-unknown`, the Node may already exist. Do not retry blindly. First run
`space browse <space-id> --parent <parent-node-id> --json`, or omit `--parent` when the target was
the Space root, then decide whether to retry. Because sibling Nodes may share a name, never assume
an arbitrary same-name result is the Node created by the interrupted request.

Rename an organizational or Resource Node by stable Node ID:

```bash
univer-workspace-cli space node rename \
  <node-id> --name <new-name> --json
```

Move a Node by choosing exactly one destination form. Use `--root` only when the intended
destination is the current Space root:

```bash
univer-workspace-cli space node move \
  <node-id> --parent <destination-node-id> --json
univer-workspace-cli space node move <node-id> --root --json
```

Rename and move are direct desired-state Space writes. If their write response is interrupted, the
CLI reads the same stable Node ID and reports success only when current metadata matches the requested
name or parent. If it still returns `workspace-result-unknown`, inspect the relevant directory before
deciding whether to issue another write.

Trash is a user-authorized recursive lifecycle action. Run it only when the user explicitly asks to
remove that Node subtree from its Space location:

```bash
univer-workspace-cli space node trash <node-id> --json
```

Read and retain the returned `trashBatchId` and `nodeCount`. Trash creates a new batch and is not
blindly retryable: after `workspace-result-unknown`, do not issue the command again because the first
request may already have moved the subtree and the batch identity was not confirmed. The current CLI
does not restore or permanently remove Trash Batches.

## Worktree rule

**Start every new task in a new Worktree.** Do not select or reuse an active Worktree merely because
its name, Space, or Unit looks suitable. `worktree list` is diagnostic; it is not permission to
continue someone else's or another task's draft.

Continue an existing Worktree only when all of these are true:

1. The current request is rework or a correction for the same task.
2. This Agent already worked on that task in a known Worktree. Resolve that same Worktree from
   retained task context or from an id the user supplies specifically for this rework.
3. The Worktree is still `draft` or `ready`.

For rework, continue a `draft` Worktree directly. Reopen a `ready` Worktree before editing. Never
reuse a `merged` or `discarded` Worktree; start a new Worktree instead. If task-to-Worktree identity
is uncertain, start a new Worktree rather than guessing.

## Connect

The origin defaults to `https://workspace.univer.plus/`. Override it only when needed, then use the
two-command browser approval protocol below. Never ask the user for a password.

```bash
# Optional override:
univer-workspace-cli config set workspace.origin https://workspace.example.com

# Step 1: create an approval request. This command exits immediately.
univer-workspace-cli login --json

# Step 2: relay verificationUrl and userCode to the user, then STOP.
# Do not poll, do not run --complete, and do not continue the Workspace task.
# Wait until the user explicitly says that they approved the request.

# Step 3: only after that user confirmation, exchange the approval once.
univer-workspace-cli login --complete --json

# Compatibility only, when the caller already owns a password secret:
printf '%s\n' "$WORKSPACE_PASSWORD" | univer-workspace-cli login --username <name> --password-stdin

univer-workspace-cli whoami --json
univer-workspace-cli space list --json
```

The first command returns `status: "authorization_required"`, `verificationUrl`, `userCode`,
`expiresAt`, and `nextCommand`. The completion command also exits immediately: it returns
`status: "authenticated"` on success or `status: "authorization_pending"` if the browser approval
has not finished. If it is still pending, show the same URL/code to the user and wait for their
reply; do not create a polling loop. Password, GitHub, and Discord browser accounts all use this
same handoff.

## Start a new task

### Modify an existing file

1. Resolve the owning Space with `space list`.
2. Find the Resource Node. Prefer `space find`; use `space browse` when tree context matters.
3. If multiple candidates match, compare `path`, `spaceId`, `nodeId`, `resourceId`, and Unit type. Ask the user
   when the target remains ambiguous; never pick one by name alone.
4. Create a new Worktree, then stage the exact `resourceId`.
5. Read the returned Worktree id, then run `unit list` to confirm the staged Unit.

For a Personal Space file, use a new user-scoped Worktree:

```bash
univer-workspace-cli space find <document-name> --space <personal-space-id> --unit-type doc --json
univer-workspace-cli worktree create \
  --name <task-name> --scope user --json
univer-workspace-cli unit add \
  --worktree <new-worktree-id> --resource <resource-id> --json
univer-workspace-cli unit list --worktree <new-worktree-id> --json
```

For a Team Space file, choose scope deliberately:

- Use `--scope user` for a private Agent task.
- Use `--scope space --space <team-space-id>` when the task itself belongs to that Team Space.
  Add `--visibility space` only when Space members should see the Worktree.

After creating the Worktree, add the Resource with
`unit add --worktree <new-worktree-id> --resource <resource-id>`. Use the returned `unitId` for
all subsequent content commands; do not continue with the Node or Resource ID.

### Create a new file

Create a new Worktree first, then create or import one Worktree-local Unit:

```bash
univer-workspace-cli worktree create \
  --name <task-name> --scope space --space <team-space-id> --json

univer-workspace-cli unit create \
  --worktree <new-worktree-id> --space <team-space-id> \
  --type sheet --name <file-name> [--parent <node-id>] [--idempotency-key <key>] --json
```

Use `unit create` for an empty Unit. Use `import --file` when an office file supplies the initial
content. Do not add an unrelated Unit to an existing task Worktree.

`unit create`, `import`, and `compile-typst --apply` allocate all three identities on the server.
They accept `--idempotency-key <key>`. Normally omit it and let the CLI generate one. If a final
`workspace-result-unknown` diagnostic returns a key, reuse that exact key only to retry the same
logical operation; use a new or omitted key for an intentional second copy.

## Continue same-task rework

Use only the already-known Worktree:

```bash
univer-workspace-cli worktree get <worktree-id> --json
univer-workspace-cli unit list --worktree <worktree-id> --json
```

If it is `ready`, reopen it before editing:

```bash
univer-workspace-cli worktree reopen <worktree-id> --json
```

If it is `merged` or `discarded`, start a new Worktree and stage the current Space file again.

## Edit one Unit

Before writing Facade code, load the matching versioned Skill:

- Doc: `univer-workspace-cli skills get doc`
- Sheet: `univer-workspace-cli skills get sheet`
- Slide: `univer-workspace-cli skills get slide`
- Base: `univer-workspace-cli skills get base`
- Board: `univer-workspace-cli skills get board`

For cross-Unit composition, also load the matching Topic Skill after the Host and Source Skills:

- Embed: `univer-workspace-cli skills get embed`
- Cross-Unit formula in a Sheet cell or formula-driven Shape:
  `univer-workspace-cli skills get cross-unit-formula`

Both Topic Skills persist the stable Source `unitId` in Host metadata and load Source data on demand;
they do not resolve identity from a display name or require staging a read-only Source into the task
Worktree.

Every content command requires the full remote address:

```bash
univer-workspace-cli execute \
  --worktree <worktree-id> --unit <unit-id> -e '…' --json
univer-workspace-cli inspect range A1:C9 \
  --worktree <worktree-id> --unit <unit-id> --json
```

There is no implicit Unit and no separate save command. `execute` commits captured mutations as one
revision; read-only code creates no revision. `inspect` is always read-only.

### Embedded image commit behavior

Use the public Facade with the original image source. The system automatically converts supported
BASE64 images to Workspace FileIds and stores their bytes separately, which keeps collaboration
snapshots smaller and improves loading performance; browser clients load those images automatically.
No manual image upload, format conversion, or mutation-storage handling is needed.

When Facade readback returns a UUID and the original asset bytes are needed, download them through
the managed CLI path:

```bash
univer-workspace-cli asset download <output> --id <uuid> --worktree <worktree-id>
```

For API discovery, use `api find <term...>` when the symbol is unknown and
`api show <symbol...>` when it is known. Add `--unit slide` or `--unit doc` to remove Sheet noise.
Method signatures and enum values are authoritative; do not guess.

`execute` injects only the selected root: Sheet → `workbook` by explicit
`getWorkbook(unitId)`, Doc → `doc`, Slide → `presentation`, Board → `board`; Base injects
`univerAPI` and alias `api` without a `base` alias. Never redeclare these bindings. Sheet execution
never uses the active Workbook.

## Verify and hand off

After mutations:

1. Verify stored content with `inspect` or a read-only `execute`.
2. Capture screenshots for Sheet layout, Doc pagination, and every Slide page.
3. Mark the Worktree ready.
4. Read it back and confirm state `ready`.
5. Generate the review URL for the edited Unit.
6. Return the review URL, Worktree id, and Unit id to the user.

```bash
univer-workspace-cli worktree ready <worktree-id> --json
univer-workspace-cli worktree get <worktree-id> --json
univer-workspace-cli open --worktree <worktree-id> --unit <unit-id>
```

Do not merge or discard unless the user explicitly requests that consequential action. A later
same-task correction follows the rework flow above.

## Command map

Use `univer-workspace-cli <command> --help` as the syntax authority.

| Intent                    | Commands                                                                    |
| ------------------------- | --------------------------------------------------------------------------- |
| Connect                   | `config set workspace.origin`, `login`, `whoami`, `logout`                  |
| Discover/organize Spaces  | `space list`, `space browse`, `space find`, `space node create/rename/move` |
| Preserve original files   | `blob upload`, `blob get`, `blob download`                                  |
| Start a task              | `worktree create`, `unit create`, `unit add`                                |
| Inspect a known Worktree  | `worktree get`, `unit list`                                                 |
| Continue same-task rework | `worktree reopen`                                                           |
| Write                     | `execute`, `compile-svg`, `compile-typst`, import                           |
| Verify                    | `inspect`, `screenshot`, export                                             |
| Hand off                  | `worktree ready`, `open`                                                    |
| User-authorized lifecycle | `worktree merge`, `worktree discard`                                        |
| User-authorized cleanup   | `space node trash`                                                          |
| Find APIs/assets/guidance | `api find/show`, `resources`, `skills`                                      |
