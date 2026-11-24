# Space files, repositories and resources over MCP (host only)

An agent browses and finds files in a Space, creates, edits and renames repositories, manages labels, creates and
adds Units in a pull request, reads uploaded files, creates, renames, moves and trashes Nodes, merges or discards
pull requests, and finds and exports SVG resources. Each result matches `uvw --json` for the same operation.

## Sub-features

- MS1 seeds a folder, an uploaded file and a merged sheet in the Team Space.
- MS2 and MS3 browse and find files against the CLI.
- MS4 creates, edits and renames a repository against the CLI.
- MS5 lists, creates, edits and deletes labels against the CLI.
- MS6 creates a sheet in a pull request and lists its Units against the CLI.
- MS7 adds an existing file to a pull request against the CLI.
- MS8 gets an uploaded file against the CLI.
- MS9 creates, renames, moves and trashes Nodes against the CLI.
- MS10 merges a ready pull request and discards another against the CLI.
- MS11 runs the end-to-end product journey and screenshots the ready pull request page.
- MC1 lists the SVG resource registries against the CLI.
- MC2 finds SVG resources against the CLI.
- MC3 exports one and two SVG resources and compares the text with the files the CLI writes.
- MC4 preserves unknown handles in `failed` and an unknown registry error against the CLI.

## How to get to it (user POV)

An MCP client connected to `$MCP_URL` calls `space_browse`, `space_find`, `unit_create`, `unit_add`, `unit_list`
and `pr_merge` from the default `core` toolset, `blob_get` from `files`, and `repo_create`, `repo_edit`,
`label_list`, `label_write`, `space_node`, `pr_discard` and the `resources_*` tools from `admin`. The same
operations exist in `uvw`.

## Driving it with agent-browser and uvw

Run these in an MCP-mode instance, started as in [MCP gateway](mcp.md): `VERIFY_UVW_MCP=1 $V up`,
`$V user` and a `$V doctor` with no `FAIL` lines. Start every shell with `eval "$($V env)"`. Each `$V mcp`
call checks its usage event and credential leakage, and exit 5 fails the journey.
[MCP mode](../references/mcp-mode.md) lists the helper commands and their exit codes.

```bash
O=verify-$VERIFY_UVW_RUN
# The Team Space that M4 in mcp.md creates; this creates it on a run that skipped M4.
$V uvw repo view "$O/verify-team" --json >/dev/null 2>&1 \
  || $V cli mcp-repo-create repo create verify-team --name "Verify Team" --json id,fullName
```

### MS1. Seed files

A folder, an uploaded file and a merged sheet in the Team Space from the setup above.

```bash
$V cli mcp-ms-team repo view "$O/verify-team" --json
T=$(jq -r '.id' "$EVIDENCE/mcp-ms-team.out")
echo "mcp blob" > "$EVIDENCE/mcp-ms-notes.txt"
$V cli mcp-ms-folder space node create "$O/verify-team" --name Plans --json
FOLDER=$(jq -r '.node.nodeId' "$EVIDENCE/mcp-ms-folder.out")
$V cli mcp-ms-upload blob upload --file "$EVIDENCE/mcp-ms-notes.txt" --space "$T" --name notes.txt --json
BLOB=$(jq -r '.upload.resourceId' "$EVIDENCE/mcp-ms-upload.out")
$V cli mcp-ms-seed-pr pr create -R "$O/verify-team" -t "Seed sheet" --json
SN=$(jq -r '.number' "$EVIDENCE/mcp-ms-seed-pr.out")
SW=$(jq -r '.id' "$EVIDENCE/mcp-ms-seed-pr.out")
$V cli mcp-ms-seed-unit unit create --worktree "$SW" --space "$T" --type sheet --name Budget --json
$V cli mcp-ms-seed-ready pr ready "$SN" -R "$O/verify-team" --json
$V cli mcp-ms-seed-merge pr merge "$SN" -R "$O/verify-team" --json
jq -e '.state == "merged"' "$EVIDENCE/mcp-ms-seed-merge.out"
```

Pass when every command exits 0 and the seed pull request is `merged`. Later MS journeys
reuse `T`, `FOLDER`, `BLOB`, `O` and the Team Space ID.

### MS2. Space browse

```bash
$V mcp --toolsets all mcp-space-browse space_browse "{\"repo\":\"$O/verify-team\"}"
$V cli mcp-space-browse-cli space browse "$O/verify-team" --json
diff <(jq -S '.nodes | map(del(.url))' "$EVIDENCE/mcp-space-browse.out") <(jq -S '.nodes' "$EVIDENCE/mcp-space-browse-cli.out")
jq -e --arg origin "$ORIGIN" '.nodes | length >= 3 and all(.[]; .url == "\($origin)/nodes/\(.nodeId)")' "$EVIDENCE/mcp-space-browse.out"
jq -e --arg repo "$T" '.repo == $repo and .tool == "space_browse" and .outcome == "ok"' "$EVIDENCE/mcp-space-browse.event.json"
$V mcp --toolsets all mcp-space-browse-filter space_browse "{\"repo\":\"$T\",\"recursive\":true,\"resource_kind\":\"univer\",\"unit_type\":\"sheet\"}"
$V cli mcp-space-browse-filter-cli space browse "$T" --recursive --resource-kind univer --unit-type sheet --json
diff <(jq -S '.nodes | map(del(.url))' "$EVIDENCE/mcp-space-browse-filter.out") <(jq -S '.nodes' "$EVIDENCE/mcp-space-browse-filter-cli.out")
jq -e '.nodes | length >= 1 and all(.[]; .resource.unitType == "sheet")' "$EVIDENCE/mcp-space-browse-filter.out"
$V mcp --toolsets all mcp-space-browse-conflict space_browse "{\"repo\":\"$T\",\"resource_kind\":\"blob\",\"unit_type\":\"sheet\"}"
test $? -eq 1
$V cli mcp-space-browse-conflict-cli space browse "$T" --resource-kind blob --unit-type sheet --json
test $? -eq 1
code=$(jq -r '.code' "$EVIDENCE/mcp-space-browse-conflict.out")
test "$(cut -d: -f1 < "$EVIDENCE/mcp-space-browse-conflict-cli.err" | head -n1)" = "$code"
```

Pass when the three MCP results equal the CLI `nodes` without `url`, every node has its
`/nodes/<id>` Browser URL, the event carries the Team Space ID, and the conflicting filter
fails in both with the same code (`workspace-argument-invalid`).

### MS3. Space find

```bash
$V mcp --toolsets all mcp-space-find space_find "{\"repo\":\"$O/verify-team\",\"query\":\"budget\"}"
$V cli mcp-space-find-cli space find budget --space "$O/verify-team" --json
diff <(jq -S '.nodes | map(del(.url))' "$EVIDENCE/mcp-space-find.out") <(jq -S '.nodes' "$EVIDENCE/mcp-space-find-cli.out")
jq -e '.nodes | length == 1 and .[0].name == "Budget"' "$EVIDENCE/mcp-space-find.out"
jq -e --arg repo "$T" '.repo == $repo and .outcome == "ok"' "$EVIDENCE/mcp-space-find.event.json"
```

Pass when both exit 0, the diff is empty, exactly the `Budget` sheet is found, and the event
carries the Team Space ID.

### MS4. Repository create, edit and rename

```bash
$V mcp --toolsets all mcp-repo-new repo_create '{"slug":"mcp-admin","name":"MCP Admin","description":"Created by MCP"}'
A=$(jq -r '.id' "$EVIDENCE/mcp-repo-new.out")
$V cli mcp-repo-new-cli repo view "$O/mcp-admin" --json
diff <(jq -S 'del(.url)' "$EVIDENCE/mcp-repo-new.out") <(jq -S 'del(.starCount, .starred)' "$EVIDENCE/mcp-repo-new-cli.out")
jq -e --arg origin "$ORIGIN" '.url == "\($origin)/spaces/\(.id)" and .name == "MCP Admin" and .description == "Created by MCP"' "$EVIDENCE/mcp-repo-new.out"
jq -e --arg repo "$A" '.tool == "repo_create" and .repo == $repo and .outcome == "ok"' "$EVIDENCE/mcp-repo-new.event.json"
$V cli mcp-repo-default-cli repo create mcp-default --json
jq -e '.name == "mcp-default"' "$EVIDENCE/mcp-repo-default-cli.out"
$V mcp --toolsets all mcp-repo-default repo_create '{"slug":"mcp-default-2"}'
jq -e '.name == "mcp-default-2"' "$EVIDENCE/mcp-repo-default.out"
LONG=$(printf 'x%.0s' $(seq 351))
$V mcp --toolsets all mcp-repo-long repo_create "{\"slug\":\"mcp-long\",\"description\":\"$LONG\"}"
test $? -eq 1
$V cli mcp-repo-long-cli repo create mcp-long --description "$LONG" --json
test $? -eq 1
code=$(jq -r '.code' "$EVIDENCE/mcp-repo-long.out")
test "$(cut -d: -f1 < "$EVIDENCE/mcp-repo-long-cli.err" | head -n1)" = "$code"
$V mcp --toolsets all mcp-repo-edit repo_edit "{\"repo\":\"$O/mcp-admin\",\"name\":\"MCP Admin 2\",\"description\":\"Edited\",\"visibility\":\"private\"}"
$V cli mcp-repo-edit-cli repo view "$O/mcp-admin" --json
diff <(jq -S 'del(.url)' "$EVIDENCE/mcp-repo-edit.out") <(jq -S 'del(.starCount, .starred)' "$EVIDENCE/mcp-repo-edit-cli.out")
jq -e '.name == "MCP Admin 2" and .description == "Edited" and .publicRead == false' "$EVIDENCE/mcp-repo-edit.out"
$V mcp --toolsets all mcp-repo-publish repo_edit "{\"repo\":\"$O/mcp-admin\",\"visibility\":\"public\"}"
test $? -eq 1
jq -e '.code == "INTERACTIVE_SESSION_REQUIRED"' "$EVIDENCE/mcp-repo-publish.out"
$V cli mcp-repo-publish-cli repo view "$O/mcp-admin" --json
jq -e '.publicRead == false' "$EVIDENCE/mcp-repo-publish-cli.out"
$V mcp --toolsets all mcp-repo-edit-bad repo_edit "{\"repo\":\"$O/mcp-admin\"}"
test $? -eq 1
$V cli mcp-repo-edit-bad-cli repo edit "$O/mcp-admin" --json
test $? -eq 1
code=$(jq -r '.code' "$EVIDENCE/mcp-repo-edit-bad.out")
test "$(cut -d: -f1 < "$EVIDENCE/mcp-repo-edit-bad-cli.err" | head -n1)" = "$code"
$V mcp --toolsets all mcp-repo-rename repo_edit "{\"repo\":\"$O/mcp-admin\",\"slug\":\"mcp-admin-2\"}"
$V cli mcp-repo-rename-cli repo view "$O/mcp-admin-2" --json
diff <(jq -S 'del(.url)' "$EVIDENCE/mcp-repo-rename.out") <(jq -S 'del(.starCount, .starred)' "$EVIDENCE/mcp-repo-rename-cli.out")
$V cli mcp-repo-old-slug repo view "$O/mcp-admin" --json
test $? -eq 1
jq -e --arg repo "$A" '.tool == "repo_edit" and .repo == $repo and .outcome == "ok"' "$EVIDENCE/mcp-repo-rename.event.json"
```

Pass when every expected-success command exits 0 and each diff is empty; the repository
created without `name` takes its slug as name through both tools; the over-long description
and the empty edit fail in MCP and CLI with the same code; making the repository public over
MCP fails with `INTERACTIVE_SESSION_REQUIRED` and leaves it private; the old slug no longer
resolves; events carry the new Space ID.

### MS5. Labels

```bash
$V mcp --toolsets all mcp-label-list label_list "{\"repo\":\"$O/verify-team\"}"
$V cli mcp-label-list-cli label list -R "$O/verify-team" --json
diff <(jq -S '.labels' "$EVIDENCE/mcp-label-list.out") <(jq -S '.' "$EVIDENCE/mcp-label-list-cli.out")
jq -e --arg repo "$T" '.tool == "label_list" and .repo == $repo and .outcome == "ok"' "$EVIDENCE/mcp-label-list.event.json"
$V mcp --toolsets all mcp-label-new label_write "{\"repo\":\"$O/verify-team\",\"action\":\"create\",\"name\":\"ux\",\"color\":\"pink\",\"description\":\"UX work\"}"
$V cli mcp-label-new-cli label list -R "$O/verify-team" --json
diff <(jq -S '.' "$EVIDENCE/mcp-label-new.out") <(jq -S 'map(select(.name == "ux") | del(.openIssueCount)) | .[0]' "$EVIDENCE/mcp-label-new-cli.out")
jq -e '.color == "pink" and .description == "UX work"' "$EVIDENCE/mcp-label-new.out"
$V mcp --toolsets all mcp-label-edit label_write "{\"repo\":\"$O/verify-team\",\"action\":\"edit\",\"name\":\"ux\",\"new_name\":\"usability\",\"color\":\"purple\"}"
$V cli mcp-label-edit-cli label list -R "$O/verify-team" --json
diff <(jq -S '.' "$EVIDENCE/mcp-label-edit.out") <(jq -S 'map(select(.name == "usability") | del(.openIssueCount)) | .[0]' "$EVIDENCE/mcp-label-edit-cli.out")
jq -e '.name == "usability" and .color == "purple" and .description == "UX work"' "$EVIDENCE/mcp-label-edit.out"
$V mcp --toolsets all mcp-label-delete label_write "{\"repo\":\"$O/verify-team\",\"action\":\"delete\",\"name\":\"usability\"}"
$V cli mcp-label-delete-cli label list -R "$O/verify-team" --json
jq -e '. == {"deleted": "usability"}' "$EVIDENCE/mcp-label-delete.out"
jq -e 'all(.[]; .name != "usability")' "$EVIDENCE/mcp-label-delete-cli.out"
$V mcp --toolsets all mcp-label-bad label_write "{\"repo\":\"$O/verify-team\",\"action\":\"create\",\"name\":\"nocolor\"}"
test $? -eq 1
jq -e '.code == "workspace-argument-invalid"' "$EVIDENCE/mcp-label-bad.out"
jq -e --arg repo "$T" '.tool == "label_write" and .repo == $repo and .outcome == "ok"' "$EVIDENCE/mcp-label-delete.event.json"
```

Pass when the list equals the CLI list, each created or edited label equals the CLI's
view of it, the deleted label is gone from the CLI list, `create` without `color` fails with
`workspace-argument-invalid`, and the events carry the Team Space ID.

### MS6. Unit create in a pull request, and unit list

```bash
$V mcp --toolsets all mcp-ms-pr pr_create "{\"repo\":\"$O/verify-team\",\"title\":\"MCP units\"}"
WB=$(jq -r '.id' "$EVIDENCE/mcp-ms-pr.out")
NB=$(jq -r '.number' "$EVIDENCE/mcp-ms-pr.out")
UK="mcp-unit-$VERIFY_UVW_RUN-idempotency"
$V mcp --toolsets all mcp-unit-create unit_create "{\"worktree\":\"$WB\",\"space\":\"$O/verify-team\",\"type\":\"sheet\",\"name\":\"Forecast\",\"parent\":\"$FOLDER\",\"idempotency_key\":\"$UK\"}"
$V mcp --toolsets all mcp-unit-create-again unit_create "{\"worktree\":\"$WB\",\"space\":\"$O/verify-team\",\"type\":\"sheet\",\"name\":\"Forecast\",\"parent\":\"$FOLDER\",\"idempotency_key\":\"$UK\"}"
$V cli mcp-unit-create-cli unit list --worktree "$WB" --json
diff <(jq -S '.unit | del(.url)' "$EVIDENCE/mcp-unit-create.out") <(jq -S '.units | map(select(.name == "Forecast")) | .[0]' "$EVIDENCE/mcp-unit-create-cli.out")
diff <(jq -S '.' "$EVIDENCE/mcp-unit-create.out") <(jq -S '.' "$EVIDENCE/mcp-unit-create-again.out")
jq -e '.units | map(select(.name == "Forecast")) | length == 1' "$EVIDENCE/mcp-unit-create-cli.out"
jq -e --arg origin "$ORIGIN" --arg t "$T" --argjson n "$NB" '.unit.url == "\($origin)/spaces/\($t)/pulls/\($n)?unit=\(.unit.unitId)" and .unit.type == "sheet" and .unit.change == "added" and .unit.target.parentNodeId != null' "$EVIDENCE/mcp-unit-create.out"
jq -e --arg repo "$T" '.tool == "unit_create" and .repo == $repo and .outcome == "ok"' "$EVIDENCE/mcp-unit-create.event.json"
$V mcp --toolsets all mcp-unit-list unit_list "{\"worktree\":\"$WB\"}"
diff <(jq -S '.units | map(del(.url))' "$EVIDENCE/mcp-unit-list.out") <(jq -S '.units' "$EVIDENCE/mcp-unit-create-cli.out")
jq -e '.units | length >= 1 and all(.[]; .url != null)' "$EVIDENCE/mcp-unit-list.out"
jq -e --arg repo "$T" '.tool == "unit_list" and .repo == $repo and .outcome == "ok"' "$EVIDENCE/mcp-unit-list.event.json"
```

Pass when every command exits 0, the created Unit equals the CLI list entry without `url`, the
retry with the same key returns the identical Unit and creates no second one, `url` is the
pull request page with `?unit=`, the list equals the CLI list, and the events carry the Team
Space ID (the first from the `space` argument, the second from the Worktree).

### MS7. Unit add of an existing file

```bash
RES=$(jq -r '.nodes[0].resource.resourceId' "$EVIDENCE/mcp-space-find.out")
$V cli mcp-ms-add-pr pr create -R "$O/verify-team" -t "Add existing" --json
WA=$(jq -r '.id' "$EVIDENCE/mcp-ms-add-pr.out")
AN=$(jq -r '.number' "$EVIDENCE/mcp-ms-add-pr.out")
$V mcp --toolsets all mcp-unit-add unit_add "{\"worktree\":\"$WA\",\"resource\":\"$RES\"}"
$V cli mcp-unit-add-cli unit list --worktree "$WA" --json
diff <(jq -S '.unit | del(.url)' "$EVIDENCE/mcp-unit-add.out") <(jq -S --arg r "$RES" '.units | map(select(.resourceId == $r)) | .[0]' "$EVIDENCE/mcp-unit-add-cli.out")
jq -e '.unit.source == "trunk" and .unit.target == null and .unit.url != null' "$EVIDENCE/mcp-unit-add.out"
jq -e --arg repo "$T" '.tool == "unit_add" and .repo == $repo and .outcome == "ok"' "$EVIDENCE/mcp-unit-add.event.json"
```

Pass when both exit 0, the added Unit equals the CLI list entry without `url`, it has source
`trunk` and no target, and the event carries the Team Space ID. `RES` is the `Budget` sheet's
Resource ID from MS3, added to its own pull request `AN` (discarded in MS10).

### MS8. Blob get

```bash
$V mcp --toolsets files mcp-blob-get blob_get "{\"resource\":\"$BLOB\"}"
$V cli mcp-blob-get-cli blob get "$BLOB" --json
diff <(jq -S 'del(.node.url)' "$EVIDENCE/mcp-blob-get.out") <(jq -S '.' "$EVIDENCE/mcp-blob-get-cli.out")
jq -e --arg origin "$ORIGIN" '.node.url == "\($origin)/nodes/\(.node.nodeId)" and .resource.kind == "blob" and .resource.byteSize == 9' "$EVIDENCE/mcp-blob-get.out"
jq -e --arg repo "$T" '.tool == "blob_get" and .toolset == "files" and .repo == $repo and .outcome == "ok"' "$EVIDENCE/mcp-blob-get.event.json"
```

Pass when both exit 0, the results are equal without `node.url`, the Blob is 9 bytes, and the event
records the `files` toolset and the Team Space ID.

### MS9. Node create, rename, move and trash

```bash
$V mcp --toolsets all mcp-node-create space_node "{\"action\":\"create\",\"repo\":\"$O/verify-team\",\"name\":\"Reports\",\"parent\":\"$FOLDER\"}"
RN=$(jq -r '.node.nodeId' "$EVIDENCE/mcp-node-create.out")
$V cli mcp-node-create-cli space browse "$O/verify-team" --parent "$FOLDER" --json
diff <(jq -S '.node | del(.url)' "$EVIDENCE/mcp-node-create.out") <(jq -S --arg id "$RN" '.nodes | map(select(.nodeId == $id) | del(.path)) | .[0]' "$EVIDENCE/mcp-node-create-cli.out")
jq -e --arg repo "$T" '.tool == "space_node" and .repo == $repo and .outcome == "ok"' "$EVIDENCE/mcp-node-create.event.json"
$V mcp --toolsets all mcp-node-rename space_node "{\"action\":\"rename\",\"node\":\"$RN\",\"name\":\"Reports 2026\"}"
$V cli mcp-node-rename-cli space browse "$O/verify-team" --parent "$FOLDER" --json
diff <(jq -S '.node | del(.url)' "$EVIDENCE/mcp-node-rename.out") <(jq -S --arg id "$RN" '.nodes | map(select(.nodeId == $id) | del(.path)) | .[0]' "$EVIDENCE/mcp-node-rename-cli.out")
jq -e --arg repo "$T" '.repo == $repo and .outcome == "ok"' "$EVIDENCE/mcp-node-rename.event.json"
$V mcp --toolsets all mcp-node-move space_node "{\"action\":\"move\",\"node\":\"$RN\",\"root\":true}"
$V cli mcp-node-move-cli space browse "$O/verify-team" --json
diff <(jq -S '.node | del(.url)' "$EVIDENCE/mcp-node-move.out") <(jq -S --arg id "$RN" '.nodes | map(select(.nodeId == $id) | del(.path)) | .[0]' "$EVIDENCE/mcp-node-move-cli.out")
jq -e '.node.parentNodeId == null' "$EVIDENCE/mcp-node-move.out"
$V mcp --toolsets all mcp-node-move-bad space_node "{\"action\":\"move\",\"node\":\"$RN\",\"root\":true,\"parent\":\"$FOLDER\"}"
test $? -eq 1
$V cli mcp-node-move-bad-cli space node move "$RN" --root --parent "$FOLDER" --json
test $? -eq 1
code=$(jq -r '.code' "$EVIDENCE/mcp-node-move-bad.out")
test "$(cut -d: -f1 < "$EVIDENCE/mcp-node-move-bad-cli.err" | head -n1)" = "$code"
$V mcp --toolsets all mcp-node-trash space_node "{\"action\":\"trash\",\"node\":\"$RN\"}"
$V cli mcp-node-trash-cli space browse "$O/verify-team" --json
jq -e --arg id "$RN" '.trashBatch.root.nodeId == $id and .trashBatch.nodeCount >= 1' "$EVIDENCE/mcp-node-trash.out"
jq -e --arg id "$RN" '.nodes | all(.[]; .nodeId != $id)' "$EVIDENCE/mcp-node-trash-cli.out"
jq -e --arg repo "$T" '.tool == "space_node" and .repo == $repo and .outcome == "ok"' "$EVIDENCE/mcp-node-trash.event.json"
```

Pass when every expected-success command exits 0, each Node result equals the CLI browse entry
without `url` and `path`, giving both `root` and `parent` fails in MCP and CLI with the same
code, the trashed Node leaves the CLI browse, and each event carries the Team Space ID.

### MS10. Merge and discard

```bash
$V mcp --toolsets all mcp-ms-ready pr_ready "{\"repo\":\"$O/verify-team\",\"number\":\"$NB\"}"
$V mcp --toolsets all mcp-pr-merge pr_merge "{\"repo\":\"$O/verify-team\",\"number\":\"$NB\"}"
$V cli mcp-pr-merge-cli pr view "$NB" -R "$O/verify-team" --json
diff <(jq -S 'del(.url, .units)' "$EVIDENCE/mcp-pr-merge.out") <(jq -S 'del(.units)' "$EVIDENCE/mcp-pr-merge-cli.out")
jq -e '.units | length >= 1 and all(.[]; .mergeResult == "merged")' "$EVIDENCE/mcp-pr-merge-cli.out"
jq -e --arg origin "$ORIGIN" --arg t "$T" --argjson n "$NB" '.state == "merged" and .url == "\($origin)/spaces/\($t)/pulls/\($n)"' "$EVIDENCE/mcp-pr-merge.out"
jq -e --arg repo "$T" '.tool == "pr_merge" and .repo == $repo and .outcome == "ok"' "$EVIDENCE/mcp-pr-merge.event.json"
$V cli mcp-ms-forecast space find forecast --space "$O/verify-team" --json
jq -e '.nodes | length == 1 and .[0].name == "Forecast"' "$EVIDENCE/mcp-ms-forecast.out"
$V mcp --toolsets all mcp-pr-merge-again pr_merge "{\"repo\":\"$O/verify-team\",\"number\":\"$NB\"}"
$V cli mcp-pr-merge-again-cli pr merge "$NB" -R "$O/verify-team" --json
id=$(jq -r '.id' "$EVIDENCE/mcp-pr-merge.out")
jq -e --arg id "$id" '.id == $id and .state == "merged"' "$EVIDENCE/mcp-pr-merge-again.out"
jq -e --arg id "$id" '.id == $id and .state == "merged"' "$EVIDENCE/mcp-pr-merge-again-cli.out"
$V mcp --toolsets all mcp-pr-discard pr_discard "{\"repo\":\"$O/verify-team\",\"number\":\"$AN\"}"
$V cli mcp-pr-discard-cli pr view "$AN" -R "$O/verify-team" --json
diff <(jq -S 'del(.url, .units)' "$EVIDENCE/mcp-pr-discard.out") <(jq -S 'del(.units)' "$EVIDENCE/mcp-pr-discard-cli.out")
jq -e '.state == "discarded"' "$EVIDENCE/mcp-pr-discard.out"
jq -e --arg repo "$T" '.tool == "pr_discard" and .repo == $repo and .outcome == "ok"' "$EVIDENCE/mcp-pr-discard.event.json"
```

Pass when the ready pull request merges and the draft pull request `AN` from MS7 is discarded with results equal to the CLI view. Ready and discard return the Worktree with an empty `units`, and merge returns it read back with the merged
Units, so `units` is compared through the CLI view, which lists them, and the rest of the result through the view
without `url`, the merged Unit appears in the Space as `Forecast`, merging a second time as the same user
succeeds in MCP and CLI and returns the same merged pull request, and the events carry the Team Space ID.

### MS11. End-to-end product journey

An agent files an Issue, opens a pull request, adds a sheet and hands it over.

```bash
$V mcp --toolsets all mcp-prod-issue issue_create "{\"repo\":\"$O/verify-team\",\"title\":\"Quarterly forecast\",\"body\":\"Needs a forecast sheet\"}"
IN=$(jq -r '.number' "$EVIDENCE/mcp-prod-issue.out")
$V mcp --toolsets all mcp-prod-pr pr_create "{\"repo\":\"$O/verify-team\",\"title\":\"Add forecast sheet (#$IN)\",\"body\":\"Closes the forecast request\",\"idempotency_key\":\"mcp-prod-$VERIFY_UVW_RUN-idempotency\"}"
PW=$(jq -r '.id' "$EVIDENCE/mcp-prod-pr.out")
PRN=$(jq -r '.number' "$EVIDENCE/mcp-prod-pr.out")
$V mcp --toolsets all mcp-prod-unit unit_create "{\"worktree\":\"$PW\",\"space\":\"$O/verify-team\",\"type\":\"sheet\",\"name\":\"Q4 Forecast\"}"
$V mcp --toolsets all mcp-prod-ready pr_ready "{\"repo\":\"$O/verify-team\",\"number\":\"$PRN\"}"
$V cli mcp-prod-pr-cli pr view "$PRN" -R "$O/verify-team" --json
$V cli mcp-prod-unit-cli unit list --worktree "$PW" --json
diff <(jq -S 'del(.url, .units)' "$EVIDENCE/mcp-prod-ready.out") <(jq -S 'del(.units)' "$EVIDENCE/mcp-prod-pr-cli.out")
jq -e '.state == "ready"' "$EVIDENCE/mcp-prod-ready.out"
jq -e '.units | length == 1 and .[0].name == "Q4 Forecast" and .[0].change == "added"' "$EVIDENCE/mcp-prod-unit-cli.out"
PR_URL=$(jq -r '.url' "$EVIDENCE/mcp-prod-ready.out")
eval "$($V env)"
agent-browser open "$ORIGIN/login" && agent-browser wait 1500
agent-browser storage local set univer-workspace-language en-US && agent-browser reload && agent-browser wait 1500
agent-browser find label "Username" fill "verify-$VERIFY_UVW_RUN"
agent-browser find label "Password" fill "$(cat "${VERIFY_UVW_ROOT:-/tmp/verify-uvw}/$VERIFY_UVW_RUN/user.pw")"
agent-browser click 'form button[type=submit]'
agent-browser wait --url '**/home'
agent-browser set viewport 1280 1000
agent-browser open "$PR_URL" && agent-browser wait 3000
agent-browser screenshot "$EVIDENCE/mcp-product-pr-ready.png"
agent-browser snapshot -c > "$EVIDENCE/mcp-product-pr-ready.snapshot.txt"
grep -q "Ready" "$EVIDENCE/mcp-product-pr-ready.snapshot.txt"
grep -q "Q4 Forecast" "$EVIDENCE/mcp-product-pr-ready.snapshot.txt"
```

Pass when every command exits 0, the `ready` result equals the CLI view without `url`, the CLI
lists the one added `Q4 Forecast` sheet, the screenshot of the pull request page shows the
title `Add forecast sheet (#N)`, the `Ready` state and the `Q4 Forecast` file (open the PNG and
look; the accessibility snapshot greps are the second view), and the pull request stays `ready`: the agent
hands the `PR_URL` to the user and does not merge.

### MC1. Resource registries

```bash
$V mcp --toolsets all mcp-res-registries resources_registries '{}'
$V cli mcp-res-registries-cli resources registries --json
diff <(jq -S . "$EVIDENCE/mcp-res-registries.out") <(jq -S . "$EVIDENCE/mcp-res-registries-cli.out")
jq -e '.registries | length >= 1 and all(.[]; .resourceCount > 0)' "$EVIDENCE/mcp-res-registries.out"
jq -e '.tool == "resources_registries" and .repo == null and .outcome == "ok"' "$EVIDENCE/mcp-res-registries.event.json"
```

Pass when both exit 0, the diff is empty and the event is `ok` without a repository. The gateway container downloads
nothing for this call: it reads the catalog manifest from `@univerjs-pro/cli-assets`.

### MC2. Resource find

```bash
$V mcp --toolsets all mcp-res-find resources_find '{"query":"arrow","registry":"example-openmoji-color","limit":3}'
$V cli mcp-res-find-cli resources find arrow --registry example-openmoji-color --limit 3 --json
diff <(jq -S . "$EVIDENCE/mcp-res-find.out") <(jq -S . "$EVIDENCE/mcp-res-find-cli.out")
jq -e '.resources | length == 3' "$EVIDENCE/mcp-res-find.out"
jq -e '.limit == 3 and .total >= 3 and .query == {"queries":["arrow"],"registries":["example-openmoji-color"]}' "$EVIDENCE/mcp-res-find.out"
$V mcp --toolsets all mcp-res-find-default resources_find '{"query":"arrow"}'
$V cli mcp-res-find-default-cli resources find arrow --json
diff <(jq -S . "$EVIDENCE/mcp-res-find-default.out") <(jq -S . "$EVIDENCE/mcp-res-find-default-cli.out")
jq -e '.limit == 30' "$EVIDENCE/mcp-res-find-default.out"
```

Pass when every command exits 0, both diffs are empty, the first call returns three resources of one registry, and the default limit is 30.

### MC3. Resource export

```bash
H1=$(jq -r '.resources[0].handle' "$EVIDENCE/mcp-res-find.out")
H2=$(jq -r '.resources[1].handle' "$EVIDENCE/mcp-res-find.out")
OUT=$(mktemp -d)
$V mcp --toolsets all mcp-res-export resources_export "{\"handles\":[\"$H1\",\"$H2\"]}"
$V cli mcp-res-export-cli resources export "$H1" "$H2" --out "$OUT" --json
jq -e --arg h1 "$H1" --arg h2 "$H2" '.failed == [] and (.resources | map(.handle)) == [$h1, $h2] and (has("truncated") | not)' "$EVIDENCE/mcp-res-export.out"
jq -e '.failed == []' "$EVIDENCE/mcp-res-export-cli.out"
i=0
for h in "$H1" "$H2"; do
  diff <(jq -j --argjson i "$i" '.resources[$i].svg' "$EVIDENCE/mcp-res-export.out") "$OUT/${h//\//--}.svg"
  i=$((i+1))
done
$V mcp --toolsets all mcp-res-export-one resources_export "{\"handles\":[\"$H1\"]}"
$V cli mcp-res-export-one-cli resources export "$H1" --json
diff <(jq -S '.resources[0]' "$EVIDENCE/mcp-res-export-one.out") <(jq -S . "$EVIDENCE/mcp-res-export-one-cli.out")
rm -rf "$OUT"
```

Pass when every command exits 0, the MCP text of each SVG equals the file the CLI wrote, a single handle equals the CLI's
`{ handle, svg }` output, and nothing is truncated. The gateway writes no file except its shared catalog cache
(`MCP_RESOURCE_CACHE_DIRECTORY`, default under the container's temporary directory); it needs network access to the catalog hosts.

### MC4. Resource errors

```bash
$V mcp --toolsets all mcp-res-export-bad resources_export "{\"handles\":[\"bad\",\"$H1\",\"example-openmoji-color/zzzz\"]}"
test $? -eq 0
$V cli mcp-res-export-bad-cli resources export bad "$H1" example-openmoji-color/zzzz --out "$(mktemp -d)" --json
test $? -eq 1
diff <(jq -S '.failed' "$EVIDENCE/mcp-res-export-bad.out") <(jq -S '.failed' "$EVIDENCE/mcp-res-export-bad-cli.out")
jq -e --arg h1 "$H1" '(.resources | map(.handle)) == [$h1] and (.failed | map(.code)) == ["resource-invalid-handle","resource-not-found"]' "$EVIDENCE/mcp-res-export-bad.out"
$V mcp --toolsets all mcp-res-find-bad resources_find '{"query":"arrow","registry":"nope"}'
test $? -eq 1
$V cli mcp-res-find-bad-cli resources find arrow --registry nope --json
test $? -eq 1
code=$(jq -r '.code' "$EVIDENCE/mcp-res-find-bad.out")
test "$code" = resource-registry-not-found
test "$(cut -d: -f1 < "$EVIDENCE/mcp-res-find-bad-cli.err" | head -n1)" = "$code"
jq -e '.tool == "resources_find" and .outcome == "tool_error" and .error_code == "resource-registry-not-found"' "$EVIDENCE/mcp-res-find-bad.event.json"
```

Pass when the failed handles equal the CLI's `failed` and the good handle is still returned in the MCP result, the unknown registry fails in
MCP and CLI with the same code (`resource-registry-not-found`), and the event carries that code.

## Gotchas

- The MCP-mode gotchas in [MCP gateway](mcp.md#gotchas) apply.
