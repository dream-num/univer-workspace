---
name: blob
description: Upload, inspect, download and replace original files in remote Workspace with univer-workspace-cli, including ETag conflicts and recovery after uncertain writes. Use for Blob Resources rather than editable Univer Units or embedded image Assets.
---

# Blob files

Use the [Core Skill](../core/SKILL.md) for authentication and Space/Resource discovery.

Use Blob when the exact original bytes must remain a Workspace file instead of becoming an editable
Univer Unit:

```bash
univer-workspace-cli blob upload \
  --file <source> --space <space-id> [--parent <node-id>] \
  [--name <node-name>] [--media-type <mime>] [--idempotency-key <key>] --json
univer-workspace-cli blob get <resource-id> --json
univer-workspace-cli blob download <output> --resource <resource-id> [--force] --json
univer-workspace-cli blob replace --resource <resource-id> --file <edited-source> \
  --etag '"<downloaded-etag>"' --idempotency-key <key> --json
```

`blob upload` publishes directly to the Space; no Worktree is involved and Worktree discard cannot
undo it. It reserves stable `uploadId`, `nodeId`, and `resourceId`, streams the exact bytes, then
publishes the Node. For important agent retries, provide a unique `--idempotency-key`. Reuse that
exact key only for the same source, size, Space, parent, and name after a `workspace-result-unknown`;
never change the intent while reusing the key.

`blob download` requires an explicit output path and refuses to overwrite by default. Use `--force`
only when replacing that path is intended; replacement occurs only after the complete byte stream
has been written. Blob commands never print binary bytes to stdout.

To revise an existing Blob, download it, edit the local file, then use `blob replace` with the
exact quoted ETag from `download.etag` and a new stable idempotency key. Replacement publishes
immediately and preserves the Node, Resource, name, location, ACL and original URL; it is not a
Worktree edit. The JSON result is `replacement: { operationId, resourceId, etag }`.

On `PRECONDITION_FAILED`, download to a fresh path and reconcile the latest bytes before starting
a new replacement with a new key. Never apply a new ETag to an unreconciled older file. After a lost
response, the CLI checks the same Operation once; `workspace-result-unknown` includes its identity
and source path. Inspect that Operation before retrying the exact same file, ETag and key. A pending
Operation must not be started again; a failed Operation needs reconciliation and a new key.
Blob downloads require a quoted strong ETag and reject malformed responses before replacing local files.

Do not confuse these workflows:

- `import --file`: convert Office content into a new editable Worktree-local Univer Unit.
- `blob upload --file`: preserve and publish the source bytes as a non-editable Blob Resource.
- `export`: convert one Worktree Unit head to an Office file.
- `blob download`: retrieve one Blob Resource without conversion.
