---
name: blob
description: Upload, inspect, download and replace original files in remote Workspace, including ETag conflicts and recovery after uncertain writes. Use for Blob Resources rather than editable Univer Units or embedded image Assets.
---

# Blob files

Use the [Core Skill](../core/SKILL.md) for authentication and Space/Resource discovery.

Use Blob when the exact original bytes must remain a Workspace file instead of becoming an editable
Univer Unit:

Use `blob upload` with the original source, destination Space, optional parent, name, media type, and idempotency key. Use `blob get` with its Resource ID for metadata, and `blob download` for the original bytes. Use `blob replace` with the edited original, Resource ID, downloaded ETag, and a new stable idempotency key. Follow the `core` Skill for file transfer and source handling.

`blob upload` publishes directly to the Space; no Worktree is involved and Worktree discard cannot
undo it. It reserves stable `uploadId`, `nodeId`, and `resourceId`, streams the exact bytes, then
publishes the Node. For important agent retries, provide a unique idempotency key. Reuse that
exact key only for the same source, size, Space, parent, and name after a `workspace-result-unknown`;
never change the intent while reusing the key.

Follow the `core` Skill for download destinations, overwrite controls, and complete-byte-stream handling.

To revise an existing Blob, download it, edit the original bytes, then use `blob replace` with the
exact quoted ETag from `download.etag` and a new stable idempotency key. Replacement publishes
immediately and preserves the Node, Resource, name, location, ACL and original URL; it is not a
Worktree edit. The replacement result is `replacement: { operationId, resourceId, etag }`.

On `PRECONDITION_FAILED`, download a fresh original and reconcile the latest bytes before starting
a new replacement with a new key. Never apply a new ETag to an unreconciled older file. After a lost
response, use the `core` Skill's recovery handling; `workspace-result-unknown` identifies the uncertain Operation. Inspect that Operation before retrying the exact same file, ETag and key. A pending
Operation must not be started again; a failed Operation needs reconciliation and a new key.
Blob downloads require a quoted strong ETag. Follow the `core` Skill for malformed-response and destination-file handling.

Do not confuse these workflows:

- `import`: convert Office content into a new editable Worktree-local Univer Unit.
- `blob upload`: preserve and publish the source bytes as a non-editable Blob Resource.
- `export`: convert one Worktree Unit head to an Office file.
- `blob download`: retrieve one Blob Resource without conversion.
