# Files, Office and Markdown exchange over MCP

An agent stages bytes through upload capabilities, publishes and replaces Blobs, downloads Blobs and Worktree
image Assets, imports and exports xlsx and docx, and applies Markdown to Docs. A retry with the same idempotency
key returns the first result, other owners cannot use an upload, and size and path limits hold.

## Sub-features

- MF1 through MF9 verify capability upload/download, idempotent Blob publication/replacement, owner isolation, the browser upload page, Worktree image Assets, binary round trips, normalized file paths and the MCP body cap.
- MX7 and MX8 round-trip xlsx and docx through Office import and export.
- MX9 retries an Office import with the same upload and key and gets the original result.
- MX10 rejects a reused import key with a different upload.
- MM1 checks Markdown apply retries, CLI parity, image downloads and explicit block updates.
- MM2 preserves Markdown input errors and bounds ZIP paths.

## How to get to it (user POV)

An MCP client connected to `$MCP_URL` calls `file_upload_create` and uploads to the returned capability URL, or
hands its `page_url` to a person who uploads in the browser. It then calls `import` and `export` from the default
`core` toolset, or `blob_upload`, `blob_replace`, `blob_download`, `asset_download`, `compile_markdown` and
`export_markdown` from `files`.

## Driving it with agent-browser and uvw

Run these in an MCP-mode instance, started as in [MCP gateway](mcp.md): `VERIFY_UVW_MCP=1 $V up`,
`$V user` and a `$V doctor` with no `FAIL` lines. Start every shell with `eval "$($V env)"`. Each `$V mcp`
call checks its usage event and credential leakage, and exit 5 fails the journey.
[MCP mode](../references/mcp-mode.md) lists the helper commands and their exit codes. MF1 reads the Team Space ID from M5's evidence and MF4 needs the Personal Space ID, so start with:

```bash
O=verify-$VERIFY_UVW_RUN
# The Team Space that M4 in mcp.md creates; this creates it on a run that skipped M4.
$V uvw repo view "$O/verify-team" --json >/dev/null 2>&1 \
  || $V cli mcp-repo-create repo create verify-team --name "Verify Team" --json id,fullName
$V mcp mcp-repo-verify-team repo_view "{\"repo\":\"$O/verify-team\"}"
$V mcp mx-repo repo_view "{\"repo\":\"$O/personal\"}"
MX_SPACE=$(jq -r .id "$EVIDENCE/mx-repo.out")
```

### MF1. Stage and publish a Blob

Uses the Team Space from the setup above.

```bash
MF_KEY=$(uuidgen | tr -d -)  # one new key per journey; its retries reuse it
MF_SPACE=$(jq -r '.id' "$EVIDENCE/mcp-repo-verify-team.out")
printf 'gateway upload\n' > "$EVIDENCE/mf-original.txt"
MF_SIZE=$(wc -c < "$EVIDENCE/mf-original.txt" | tr -d ' ')
$V mcp mf-reserve file_upload_create "$(jq -nc --argjson size "$MF_SIZE" '{purpose:"blob",file_name:"original.txt",size:$size,media_type:"text/plain"}')"
MF_UPLOAD=$(jq -r '.upload.upload_id' "$EVIDENCE/mf-reserve.out")
node .agents/skills/verify-uvw/bin/mcp-file.mjs put "$EVIDENCE/mf-reserve.out" "$EVIDENCE/mf-original.txt"
$V mcp --toolsets files --expect-event '.executor == "none" and .cost.upload_bytes > 0' mf-publish blob_upload "$(jq -nc --arg upload "$MF_UPLOAD" --arg space "$MF_SPACE" --arg key "mf-publish-$MF_KEY" '{upload_id:$upload,space:$space,name:"gateway.txt",idempotency_key:$key}')"
MF_RESOURCE=$(jq -r '.upload.resourceId' "$EVIDENCE/mf-publish.out")
$V cli mf-get-cli blob get "$MF_RESOURCE" --json
diff <(jq -S '.upload | {node:(.node | del(.url)),resource}' "$EVIDENCE/mf-publish.out") <(jq -S '.' "$EVIDENCE/mf-get-cli.out")
$V mcp --toolsets files mf-publish-retry blob_upload "$(jq -nc --arg upload "$MF_UPLOAD" --arg space "$MF_SPACE" --arg key "mf-publish-$MF_KEY" '{upload_id:$upload,space:$space,name:"gateway.txt",idempotency_key:$key}')"
diff "$EVIDENCE/mf-publish.out" "$EVIDENCE/mf-publish-retry.out"
$V mcp --toolsets files --expect-event '.executor == "none" and .cost.export_bytes > 0' mf-download blob_download "$(jq -nc --arg resource "$MF_RESOURCE" '{resource:$resource}')"
node .agents/skills/verify-uvw/bin/mcp-file.mjs get "$EVIDENCE/mf-download.out" "$EVIDENCE/mf-downloaded.txt"
node -e 'const fs=require("node:fs"),c=require("node:crypto");const hash=p=>c.createHash("sha256").update(fs.readFileSync(p)).digest("hex");if(hash(process.argv[1])!==hash(process.argv[2]))process.exit(1);console.log(hash(process.argv[1]))' "$EVIDENCE/mf-original.txt" "$EVIDENCE/mf-downloaded.txt" > "$EVIDENCE/mf-sha256.txt"
```

Pass when upload and retry return the same Resource, CLI metadata matches, download SHA-256 matches, and the helper asserts the attachment, nosniff, sandbox and no-store headers.

### MF2. Replace a Blob with its ETag

```bash
MF_KEY=$(uuidgen | tr -d -)  # one new key per journey; its retries reuse it
printf 'replacement bytes\n' > "$EVIDENCE/mf-replacement.txt"
MF_NEW_SIZE=$(wc -c < "$EVIDENCE/mf-replacement.txt" | tr -d ' ')
$V mcp mf-replace-reserve file_upload_create "$(jq -nc --argjson size "$MF_NEW_SIZE" '{purpose:"blob",file_name:"replacement.txt",size:$size,media_type:"text/plain"}')"
MF_REPLACE_UPLOAD=$(jq -r '.upload.upload_id' "$EVIDENCE/mf-replace-reserve.out")
node .agents/skills/verify-uvw/bin/mcp-file.mjs put "$EVIDENCE/mf-replace-reserve.out" "$EVIDENCE/mf-replacement.txt"
MF_ETAG=$(jq -r '.etag' "$EVIDENCE/mf-download.out")
MF_REPLACE_ARGS=$(jq -nc --arg resource "$MF_RESOURCE" --arg upload "$MF_REPLACE_UPLOAD" --arg etag "$MF_ETAG" --arg key "mf-replace-$MF_KEY" '{resource:$resource,upload_id:$upload,etag:$etag,idempotency_key:$key}')
$V mcp --toolsets files mf-replace blob_replace "$MF_REPLACE_ARGS"
$V mcp --toolsets files mf-replace-retry blob_replace "$MF_REPLACE_ARGS"
diff "$EVIDENCE/mf-replace.out" "$EVIDENCE/mf-replace-retry.out"
$V mcp --toolsets files mf-replaced-download blob_download "$(jq -nc --arg resource "$MF_RESOURCE" '{resource:$resource}')"
node .agents/skills/verify-uvw/bin/mcp-file.mjs get "$EVIDENCE/mf-replaced-download.out" "$EVIDENCE/mf-replaced.txt"
cmp "$EVIDENCE/mf-replacement.txt" "$EVIDENCE/mf-replaced.txt"
$V mcp --toolsets files mf-stale-replace blob_replace "$(jq -c '.idempotency_key += "-stale"' <<< "$MF_REPLACE_ARGS")"
test $? -eq 1
jq -e '.code | test("conflict|precondition|etag"; "i")' "$EVIDENCE/mf-stale-replace.out"
```

Pass when replacement retains identity, retries return the same result, the link returns new bytes and a new replacement with the old ETag fails.

### MF3. Capability and owner boundaries, browser upload

```bash
MF_KEY=$(uuidgen | tr -d -)  # one new key per journey; its retries reuse it
$V mcp mf-page-reserve file_upload_create '{"purpose":"blob","file_name":"never-render-this-name.txt","media_type":"text/plain"}'
MF_PAGE=$(jq -r '.upload.page_url' "$EVIDENCE/mf-page-reserve.out")
curl -fsS -D "$EVIDENCE/mf-page.headers" "$MF_PAGE" > "$EVIDENCE/mf-page.html"
grep -q "default-src 'none'; script-src 'nonce-" "$EVIDENCE/mf-page.headers"
! grep -q 'never-render-this-name' "$EVIDENCE/mf-page.html"
MF_WRONG=$(jq -r '.upload.upload_url | sub("token=.*"; "token=" + ("0" * 64))' "$EVIDENCE/mf-page-reserve.out")
test "$(curl -sS -o /dev/null -w '%{http_code}' -X PUT -H 'Content-Length: 15' --data-binary 'gateway upload
' "$MF_WRONG")" = 404
agent-browser open "$MF_PAGE"
agent-browser snapshot -i > "$EVIDENCE/mf-page.snapshot.txt"
agent-browser screenshot "$EVIDENCE/mf-upload-page.png"
agent-browser upload 'input[type=file]' "$EVIDENCE/mf-original.txt"
agent-browser click 'button'
agent-browser wait --text 'Upload complete'
agent-browser screenshot "$EVIDENCE/mf-upload-complete.png"
MF_PAGE_UPLOAD=$(jq -r '.upload.upload_id' "$EVIDENCE/mf-page-reserve.out")
$V mcp --toolsets files mf-page-publish blob_upload "$(jq -nc --arg upload "$MF_PAGE_UPLOAD" --arg space "$MF_SPACE" --arg key "mf-page-$MF_KEY" '{upload_id:$upload,space:$space,idempotency_key:$key}')"
$V mcp --toolsets files mf-page-download blob_download "$(jq -nc --arg resource "$(jq -r '.upload.resourceId' "$EVIDENCE/mf-page-publish.out")" '{resource:$resource}')"
node .agents/skills/verify-uvw/bin/mcp-file.mjs get "$EVIDENCE/mf-page-download.out" "$EVIDENCE/mf-page-downloaded.txt"
cmp "$EVIDENCE/mf-original.txt" "$EVIDENCE/mf-page-downloaded.txt"
node --input-type=module - "$PWD" "$ORIGIN" "$MCP_URL" "$MF_UPLOAD" "$MF_SPACE" "$EVIDENCE/mf-foreign.json" <<'JS'
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const [root, origin, url, upload, space, evidence] = process.argv.slice(2);
const username = 'foreign-' + randomBytes(6).toString('hex');
const response = await fetch(origin + '/api/auth/password/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, displayName: 'Foreign upload check', password: randomBytes(24).toString('hex') }) });
assert(response.ok, 'second user registers');
const session = response.headers.getSetCookie().map(value => /^workspace_session=([^;]+)/.exec(value)?.[1]).find(Boolean);
assert(session, 'second user session exists');
const require = createRequire(root + '/apps/mcp/package.json');
const { Client, StreamableHTTPClientTransport } = await import(require.resolve('@modelcontextprotocol/client'));
const client = new Client({ name: 'foreign-upload-check', version: '1' });
try {
  await client.connect(new StreamableHTTPClientTransport(new URL(url + '?toolsets=files'), { requestInit: { headers: { Authorization: 'Bearer ' + session } } }));
  const result = await client.callTool({ name: 'blob_upload', arguments: { upload_id: upload, space, name: 'forbidden.txt', idempotency_key: username } });
  assert(result.isError);
  const body = JSON.parse(result.content[0].text);
  assert.equal(body.code, 'workspace-upload-not-found');
  writeFileSync(evidence, JSON.stringify(body, null, 2) + '\n');
} finally { await client.close(); }
JS
```

Pass when the wrong token is refused, the page has a strict CSP and no supplied name, browser upload succeeds, and a second user's tool call reports upload-not-found.

### MF4. Download a Worktree image Asset

```bash
MF_KEY=$(uuidgen | tr -d -)  # one new key per journey; its retries reuse it
$V mcp mf-asset-pr pr_create "$(jq -nc --arg repo "$O/personal" --arg key "mf-asset-pr-$MF_KEY" '{repo:$repo,title:"Asset transfer",idempotency_key:$key}')"
MF_WORKTREE=$(jq -r '.id' "$EVIDENCE/mf-asset-pr.out")
$V mcp mf-asset-unit unit_create "$(jq -nc --arg worktree "$MF_WORKTREE" --arg space "$MX_SPACE" --arg key "mf-asset-unit-$MF_KEY" '{worktree:$worktree,space:$space,type:"sheet",name:"Image asset",idempotency_key:$key}')"
MF_UNIT=$(jq -r '.unit.unitId' "$EVIDENCE/mf-asset-unit.out")
node --input-type=module - "$ORIGIN" "$RUN" "$MF_WORKTREE" "$MF_UNIT" "$EVIDENCE" <<'JS'
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
const [origin,run,worktree,unit,evidence] = process.argv.slice(2);
const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64');
writeFileSync(evidence + '/mf-image.png', bytes);
const form = new FormData(); form.set('file', new Blob([bytes], { type: 'image/png' }), 'image.png');
const response = await fetch(`${origin}/universer-api/worktrees/${worktree}/stream/file/upload?size=${bytes.length}&source=3&assign=${unit}`, { method: 'POST', headers: { cookie: 'workspace_session=' + readFileSync(run+'/home/mcp-session','utf8').trim() }, body: form });
assert(response.ok, 'public image upload succeeds: ' + response.status);
writeFileSync(evidence + '/mf-asset-upload.json', JSON.stringify(await response.json()));
JS
MF_ASSET=$(jq -r '.FileId' "$EVIDENCE/mf-asset-upload.json")
$V mcp --toolsets files --expect-event '.executor == "none" and .cost.export_bytes > 0' mf-asset-download asset_download "$(jq -nc --arg id "$MF_ASSET" --arg worktree "$MF_WORKTREE" '{id:$id,worktree:$worktree}')"
node .agents/skills/verify-uvw/bin/mcp-file.mjs get "$EVIDENCE/mf-asset-download.out" "$EVIDENCE/mf-asset-mcp.png"
$V cli mf-asset-cli asset download "$EVIDENCE/mf-asset-cli.png" --id "$MF_ASSET" --worktree "$MF_WORKTREE" --json
cmp "$EVIDENCE/mf-image.png" "$EVIDENCE/mf-asset-mcp.png"
cmp "$EVIDENCE/mf-asset-cli.png" "$EVIDENCE/mf-asset-mcp.png"
```

Pass when MCP, public upload and CLI return identical image bytes, with the download headers enforced by the helper.

### MF5. Pending uploads and purpose validation

```bash
MF_KEY=$(uuidgen | tr -d -)  # one new key per journey; its retries reuse it
$V mcp mf-pending-reserve file_upload_create '{"purpose":"blob","file_name":"pending.txt","size":3,"media_type":"text/plain"}'
MF_PENDING=$(jq -r '.upload.upload_id' "$EVIDENCE/mf-pending-reserve.out")
$V mcp --toolsets files mf-pending-publish blob_upload "$(jq -nc --arg upload "$MF_PENDING" --arg space "$MF_SPACE" --arg key "mf-pending-$MF_KEY" '{upload_id:$upload,space:$space,name:"pending.txt",idempotency_key:$key}')"
test $? -eq 1
jq -e '.code == "workspace-upload-not-ready"' "$EVIDENCE/mf-pending-publish.out"
$V mcp mf-invalid-purpose file_upload_create '{"purpose":"office-import","file_name":"invalid.txt","size":3,"media_type":"text/plain"}'
test $? -eq 1
jq -e '.code == "workspace-upload-media-type-invalid"' "$EVIDENCE/mf-invalid-purpose.out"
```

Pass when a reservation cannot be published before bytes arrive and Office-purpose validation refuses plain text.

### MF6. Upload upper limit, single PUT and download capability

```bash
node --input-type=module - "$EVIDENCE" <<'JS'
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
const evidence = process.argv[2];
const { upload } = JSON.parse(readFileSync(evidence + '/mf-pending-reserve.out', 'utf8'));
const statuses = {};
statuses.large = (await fetch(upload.upload_url, { method: 'PUT', body: 'abcd' })).status;
assert.equal(statuses.large, 413);
statuses.ready = (await fetch(upload.upload_url, { method: 'PUT', body: 'ab' })).status;
assert.equal(statuses.ready, 204);
statuses.repeat = (await fetch(upload.upload_url, { method: 'PUT', body: 'xyz' })).status;
assert.equal(statuses.repeat, 409);
const { download } = JSON.parse(readFileSync(evidence + '/mf-replaced-download.out', 'utf8'));
const url = new URL(download.url); url.search = '';
statuses.unsigned = (await fetch(url)).status;
assert.equal(statuses.unsigned, 404);
writeFileSync(evidence + '/mf-capability-statuses.json', JSON.stringify(statuses, null, 2) + '\n');
JS
```

Pass when over-limit files leave an upload retryable, smaller files are accepted, a second successful PUT cannot overwrite bytes, and an unsigned download is refused.

### MF7. Binary XLSX and PNG round trips

Generates a valid 50,000-row OpenXML workbook larger than 4 MiB and a PNG. Python 3 is needed for standard-library fixture generation.

```bash
MF_KEY=$(uuidgen | tr -d -)  # one new key per journey; its retries reuse it
python3 .agents/skills/verify-uvw/bin/file-fixtures.py "$EVIDENCE" > "$EVIDENCE/mf-binary-fixtures.tsv"
for MF_EXT in xlsx png; do
  if [ "$MF_EXT" = xlsx ]; then MF_TYPE=application/vnd.openxmlformats-officedocument.spreadsheetml.sheet; else MF_TYPE=image/png; fi
  $V mcp "mf-binary-$MF_EXT-reserve" file_upload_create "$(jq -nc --arg name "mf-binary.$MF_EXT" --arg type "$MF_TYPE" '{purpose:"blob",file_name:$name,media_type:$type}')"
  MF_BINARY_UPLOAD=$(jq -r '.upload.upload_id' "$EVIDENCE/mf-binary-$MF_EXT-reserve.out")
  node .agents/skills/verify-uvw/bin/mcp-file.mjs put "$EVIDENCE/mf-binary-$MF_EXT-reserve.out" "$EVIDENCE/mf-binary.$MF_EXT"
  $V mcp --toolsets files "mf-binary-$MF_EXT-publish" blob_upload "$(jq -nc --arg upload "$MF_BINARY_UPLOAD" --arg space "$MF_SPACE" --arg key "mf-binary-$MF_EXT-$MF_KEY" '{upload_id:$upload,space:$space,idempotency_key:$key}')"
  MF_BINARY_RESOURCE=$(jq -r '.upload.resourceId' "$EVIDENCE/mf-binary-$MF_EXT-publish.out")
  $V mcp --toolsets files "mf-binary-$MF_EXT-download" blob_download "$(jq -nc --arg resource "$MF_BINARY_RESOURCE" '{resource:$resource}')"
  node .agents/skills/verify-uvw/bin/mcp-file.mjs get "$EVIDENCE/mf-binary-$MF_EXT-download.out" "$EVIDENCE/mf-binary-downloaded.$MF_EXT"
  cmp "$EVIDENCE/mf-binary.$MF_EXT" "$EVIDENCE/mf-binary-downloaded.$MF_EXT"
  shasum -a 256 "$EVIDENCE/mf-binary.$MF_EXT" "$EVIDENCE/mf-binary-downloaded.$MF_EXT" > "$EVIDENCE/mf-binary-$MF_EXT-sha256.txt"
done
$V mcp mf-small-page-reserve file_upload_create '{"purpose":"blob","file_name":"small.png","size":1,"media_type":"image/png"}'
agent-browser open "$(jq -r '.upload.page_url' "$EVIDENCE/mf-small-page-reserve.out")"
agent-browser upload 'input[type=file]' "$EVIDENCE/mf-binary.png"
agent-browser find role button click --name 'Upload'
agent-browser wait --text 'File is too large'
agent-browser screenshot "$EVIDENCE/mf-page-too-large.png"
```

Pass when both hashes match after PUT, publication and download, default Blob names are preserved, and the browser explains a 413 without asking for another link.

### MF8. Normalized binary upload paths

Needs the MF7 PNG and the Team Space from the setup above.

```bash
MF_KEY=$(uuidgen | tr -d -)  # one new key per journey; its retries reuse it
for MF_PATH in canonical dot; do
  $V mcp "mf-path-$MF_PATH-reserve" file_upload_create '{"purpose":"blob","file_name":"path.png","media_type":"image/png"}'
  MF_PATH_URL=$(jq -r '.upload.upload_url' "$EVIDENCE/mf-path-$MF_PATH-reserve.out")
  if [ "$MF_PATH" = dot ]; then MF_PATH_URL=$(printf '%s' "$MF_PATH_URL" | sed 's@/mcp/files/@/mcp/./files/@'); fi
  curl --fail --silent --show-error --path-as-is -X PUT --data-binary "@$EVIDENCE/mf-binary.png" "$MF_PATH_URL" > "$EVIDENCE/mf-path-$MF_PATH-put.out"
  MF_PATH_UPLOAD=$(jq -r '.upload.upload_id' "$EVIDENCE/mf-path-$MF_PATH-reserve.out")
  $V mcp --toolsets files "mf-path-$MF_PATH-publish" blob_upload "$(jq -nc --arg upload "$MF_PATH_UPLOAD" --arg space "$MF_SPACE" --arg key "mf-path-$MF_PATH-$MF_KEY" '{upload_id:$upload,space:$space,idempotency_key:$key}')"
  MF_PATH_RESOURCE=$(jq -r '.upload.resourceId' "$EVIDENCE/mf-path-$MF_PATH-publish.out")
  $V mcp --toolsets files "mf-path-$MF_PATH-download" blob_download "$(jq -nc --arg resource "$MF_PATH_RESOURCE" '{resource:$resource}')"
  node .agents/skills/verify-uvw/bin/mcp-file.mjs get "$EVIDENCE/mf-path-$MF_PATH-download.out" "$EVIDENCE/mf-path-$MF_PATH.png"
  cmp "$EVIDENCE/mf-binary.png" "$EVIDENCE/mf-path-$MF_PATH.png"
done
shasum -a 256 "$EVIDENCE/mf-binary.png" "$EVIDENCE/mf-path-canonical.png" "$EVIDENCE/mf-path-dot.png" > "$EVIDENCE/mf-path-sha256.txt"
```

Pass when canonical and dot-segment PUTs survive publication and download with the same SHA-256 as the original binary.

### MF9. Normalized MCP body cap

Sends more than 4 MiB without client URL normalization.

```bash
python3 - "$EVIDENCE/mf-oversized.json" <<'PY'
import json, sys
with open(sys.argv[1], 'w') as f:
    json.dump(dict(jsonrpc="2.0", id=1, method="ping", params=dict(pad="x" * (5 * 1024 * 1024))), f)
PY
for MF_ESCAPE in '/mcp/files/../../mcp' '/mcp/files/%2e%2e/%2e%2e/mcp'; do
  MF_CAP_LABEL=plain
  if [ "$MF_ESCAPE" != '/mcp/files/../../mcp' ]; then MF_CAP_LABEL=encoded; fi
  MF_CAP_STATUS=$(curl --silent --show-error --path-as-is --max-time 15 -o "$EVIDENCE/mf-cap-$MF_CAP_LABEL.body" -w '%{http_code}' -X POST -H 'Content-Type: application/json' --data-binary "@$EVIDENCE/mf-oversized.json" "${MCP_URL%/mcp}$MF_ESCAPE")
  printf '%s\n' "$MF_CAP_STATUS" > "$EVIDENCE/mf-cap-$MF_CAP_LABEL.status"
  test "$MF_CAP_STATUS" = 413
done
```

Pass when both oversized requests receive HTTP 413 through the normalized MCP route.

### MX7. Office xlsx round trip

```bash
node .agents/skills/verify-uvw/bin/mcp-office-roundtrip.mjs xlsx
```

Pass when the fixture has two sheets, numeric cells and a formula; a signed PUT and MCP import
succeed without reserving an exact upload size; MCP inspect matches CLI import; and downloaded MCP export matches a CLI export of the
same Unit after parsing through CLI import and inspect. Keep the upload status and headers.
If the base gateway upload adapter refuses or corrupts the binary PUT, record that failure and
stop this journey. Do not bypass the upload route.

### MX8. Office docx round trip

```bash
node .agents/skills/verify-uvw/bin/mcp-office-roundtrip.mjs docx
```

Pass with the same upload, import, inspection and export checks for a Doc containing text,
using a reserved size upper bound larger than the actual file.
The same base binary-upload defect may block this journey before import.

### MX9. Office import idempotent retry

Repeat the same upload and key after a delay and verify the Worktree still has one imported Unit.

```bash
node .agents/skills/verify-uvw/bin/mcp-office-retry.mjs
```

Pass when both calls directly return the same Unit ID and the Worktree Unit list is unchanged. A successful same-key retry must return the original import result, without a job handle.

### MX10. Reused import key with a different upload

Import one upload with a key, then a different upload with the same key. Run after MX7.

```bash
node .agents/skills/verify-uvw/bin/mcp-job-conflict.mjs
```

Pass when the second call fails with `workspace-idempotency-conflict`, the Worktree Unit list is unchanged,
and repeating the first arguments returns the original Unit ID.

### MM1. Markdown compile, native readback and block update

```bash
node .agents/skills/verify-uvw/bin/mcp-markdown-roundtrip.mjs
```

Pass when an assets ZIP uploads by PUT, compile-only returns JavaScript through `mcp-call`
with `executor: none`, null Unit/repository identities and ZIP upload bytes, and Markdown with a heading, list, table and image
creates a Doc in a new pull request, and the same key returns the same Unit and source map.
Compare its inspection with CLI compile-markdown. Export the same native blocks through
MCP and CLI, compare Markdown and source maps, and download the image to compare its bytes.
Native export generates fresh asset filenames, so compare Markdown after normalizing only
that random filename component. Replace one explicit block and inspect the changed heading
and preserved list. Evidence uses the `mm-markdown-` prefix and includes a summary JSON.

### MM2. Markdown input errors and bounded ZIP paths

Run after MM1.

```bash
node .agents/skills/verify-uvw/bin/mcp-markdown-errors.mjs
```

Pass when inline HTML, footnotes, missing images with and without a ZIP, duplicate block IDs
and remote, absolute, traversal and file URL image paths fail in every compile mode.
Invalid source maps and unmapped blocks for update and export must also fail. All return `workspace-markdown-invalid` with messages and diagnostics.
The HTML error message must match CLI stderr. A ZIP with a 2,000-directory path must fail
with `workspace-argument-invalid` while a concurrent executor inspection matches the baseline.
Both gateway durations must stay below the larger of 2 seconds and five times the warm
baseline inspection duration. This is a rejection latency guard, not a throughput benchmark.
Evidence uses `mm-errors-` and includes the CLI transcript, per-call events and summary JSON.

## Gotchas

- The MCP-mode gotchas in [MCP gateway](mcp.md#gotchas) apply.
