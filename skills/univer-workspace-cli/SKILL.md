---
name: univer-workspace-cli
description: Create, edit, inspect, and review remote Univer Workspace documents with univer-workspace-cli. Use for connecting an agent to Workspace, finding Personal or Team Space files, and completing document tasks through Worktrees. Not for local .univer files handled by univer or for embedding the Univer SDK in an application.
---

# Univer Workspace CLI

This is the discovery entry for the remote Workspace CLI. Detailed commands, Facade APIs,
and verification guidance come from the installed CLI's version-matched operational Skills.
Use the user's chosen Workspace service and task scope; do not substitute the local `univer` CLI.

## Set up the connection

Check whether `univer-workspace-cli` is available before installing it. If missing, install it
in the environment where the agent runs:

```bash
npm install --global univer-workspace-cli@latest
```

The default service is `https://space.univer.ai/`. Preserve an existing configured origin unless
the task targets another service. For a user-specified deployment, configure its actual origin;
never run the placeholder literally:

```bash
univer-workspace-cli config set workspace.origin <origin>
univer-workspace-cli whoami --json
```

If authentication is needed, start browser-approved login:

```bash
univer-workspace-cli login --json
```

Give the user the returned verification URL and code, then stop and wait for their reply.
Do not poll or run the completion command while approval is pending. After the user confirms
approval, exchange it once:

```bash
univer-workspace-cli login --complete --json
```

Do not request the user's password or copy browser cookies into the CLI. If completion fails,
use the returned diagnostic; do not loop or infer approval from elapsed time.

## Load operational guidance

Before operating on Workspace content, read the installed core Skill:

```bash
univer-workspace-cli skills get core
univer-workspace-cli skills list
```

Load the relevant Unit Skill before authoring: `sheet`, `doc`, `slide`, `base`, or `board`.
For other content, load `blob` for original-file transfer/replacement or `html-view` for live
HTML pages. Load `embed` or `cross-unit-formula` when composing Units, together with the
source and host Unit Skills.

```bash
univer-workspace-cli skills get sheet
univer-workspace-cli skills get <name> --full
univer-workspace-cli skills read <name> <resource-path>
```

`skills get` lists available reference paths and read commands. Read the references needed for
the task, or use `--full` to include all bundled references and templates. Do not depend on a
repository checkout, guessed installation paths, or a different CLI version's API examples.

## Complete the task

- Discover the intended Space and file; use returned IDs rather than treating names as IDs.
- For a new editable Unit task, create a new Worktree. Reuse a known Worktree only to continue
  that same task. Read-only inspection does not require creating a task draft.
- Follow the loaded Skills to author and verify. Read back stored content; inspect rendered
  output when appearance matters. A successful command alone is not verification.
- Hand off the verified result with its review URL. Leave merge or discard to the user's
  decision unless the user has explicitly authorized that action.
- Blob and Space organization writes are direct operations, outside Worktree review. Follow
  their operational guidance rather than implying a Worktree can undo them.

## Diagnose and upgrade

Use `univer-workspace-cli <command> --help` for installed syntax and
`univer-workspace-cli doctor --json` for diagnostics. If setup or a runtime failure blocks the
task, report the concrete issue instead of bypassing the Workspace workflow.

When an upgrade is needed, finish active work before installing the newer package with npm.
This CLI has no `update` command. After upgrading, reload core and the relevant operational
Skills so the guidance matches the installed version.
