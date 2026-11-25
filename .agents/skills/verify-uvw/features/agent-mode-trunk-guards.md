# Agent Mode: Trunk write guards

An agent that may not change a repository's Trunk directly has no route around that. A Viewer agent's edits and
restores from history are refused on the realtime route, and so are those of an agent that does not own a repository
that requires checks, which also cannot restore or permanently delete a Trash Batch there. A restore from history needs
Edit on every range protection at head, so an Editor agent cannot restore over a range protected from it. The
Collaboration SDK's own routes that remove and recover Units refuse every client, the owner included. Each refusal
leaves Trunk at the same revision with the same values.

## Sub-features

- TG1 has a claimed Viewer agent post an edit and a restore from history to the realtime route, and restore and delete
  a Trash Batch. The changesets get `permission_rej` and the Trash calls 404.
- TG2 calls `DELETE /universer-api/snapshot/-/units` and `POST /universer-api/snapshot/-/units/recover` as the Viewer
  agent and as the owner. Each answers 403 with `PERMISSION_DENIED`, and the Sheet still reads.
- TG3 makes the agent an Editor of a repository that requires checks. Its edit and restore get `permission_rej`, and
  its Trash restore and permanent delete answer `AGENT_NOT_ALLOWED`. Back in `review`, the same edit commits.
- TG4 keeps the agent an Editor in `review`. It restores the Sheet, then the owner protects B2 for the owner alone.
  The agent's restore is now refused, the owner's same restore commits, and B2 stays protected.

## How to get to it (user POV)

A person edits Trunk in the Browser's editor. Its collaboration client joins the Unit over
`/universer-api/comb/connect` and posts each changeset to `/universer-api/comb/<type>/unit/<unit>/new_changes`. History's
`Restore this version` posts a `univer.mutation.revert-version` changeset the same way, and protecting a range creates
an object under `/universer-api/authz` and posts `sheet.mutation.add-range-protection`. The Trash page calls
`POST /api/trash-batches/<id>/restore` and `DELETE /api/trash-batches/<id>`. The SDK also serves the Unit remove and
recover routes, which no Workspace client calls. An agent that skips the Browser can call each of these with its own
session, and that is the path these journeys take. [`bin/trunk-changeset.mjs`](../bin/trunk-changeset.mjs) is the
realtime client: it joins a Trunk Sheet with a session from a curl cookie jar, posts one changeset at head, and prints
the event the server answers with and the head it posted on.

## Driving it with agent-browser and uvw

Start every shell with `eval "$($V env)"`. The run user O holds a Team Space R with a Sheet `Sales` on Trunk and edits
its B2 once, so revision 1 is an earlier version to restore. O moves a folder `Old` to Trash, as Trash Batch B. An agent
A comes from `POST /api/auth/guest`, the Browser's `Continue as a guest agent`, and O claims it with the call the claim
page makes. A is a Viewer of R. The cookie jars, A's claim code and O's password stay in `$UNIVER_HOME/tg`, which
`$V down` deletes.

```bash
RUN=${VERIFY_UVW_ROOT:-/tmp/verify-uvw}/$VERIFY_UVW_RUN
O=verify-$VERIFY_UVW_RUN; R=$O/trunk-guards; TG=$UNIVER_HOME/tg
TC=.agents/skills/verify-uvw/bin/trunk-changeset.mjs
mkdir -m 700 -p "$TG"
curl --fail-with-body -sS -c "$TG/owner.cookies" -o /dev/null -X POST "$ORIGIN/api/auth/password/login" -H 'content-type: application/json' \
  -d "{\"username\":\"$O\",\"password\":\"$(cat "$RUN/user.pw")\"}"
curl --fail-with-body -sS -c "$TG/agent.cookies" -o "$TG/agent.json" -X POST "$ORIGIN/api/auth/guest" -H 'content-type: application/json' -d '{}'
curl --fail-with-body -sS -b "$TG/agent.cookies" -o "$TG/claim.json" -X POST "$ORIGIN/api/agents/claim-codes"
curl --fail-with-body -sS -b "$TG/owner.cookies" -o /dev/null -X POST "$ORIGIN/api/agents/claim" -H 'content-type: application/json' \
  -d "{\"code\":\"$(jq -r .code "$TG/claim.json")\"}"
A=$(jq -r .agent.username "$TG/agent.json")
$V cli tg-repo repo create trunk-guards --name "Trunk guards" --json id
$V cli tg-seed pr create -R "$R" -t Seed --json id,number
$V cli tg-sales unit create --worktree "$(jq -r .id "$EVIDENCE/tg-seed.out")" --space "$R" --type sheet --name Sales --json
U=$(jq -r .unit.unitId "$EVIDENCE/tg-sales.out")
$V cli tg-seed-exec execute --worktree "$(jq -r .id "$EVIDENCE/tg-seed.out")" --unit "$U" --json -e 'univerAPI.getActiveWorkbook().getActiveSheet().getRange("A1:B2").setValues([["Region","Total"],["North",40]]);'
$V cli tg-seed-ready pr ready "$(jq -r .number "$EVIDENCE/tg-seed.out")" -R "$R" --json state
$V cli tg-seed-merge pr merge "$(jq -r .number "$EVIDENCE/tg-seed.out")" -R "$R" --json state
node "$TC" "$TG/owner.cookies" "$U" sheet.mutation.set-range-values '{"cellValue":{"1":{"1":{"v":41}}}}' > "$EVIDENCE/tg-owner-edit.json"
jq -e '. == {event: "changeset_ack", baseRev: 1}' "$EVIDENCE/tg-owner-edit.json"
$V cli tg-old space node create "$R" --name Old --json
$V cli tg-old-trash space node trash "$(jq -r .node.nodeId "$EVIDENCE/tg-old.out")" --json
B=$(jq -r .trashBatch.trashBatchId "$EVIDENCE/tg-old-trash.out")
$V cli tg-viewer repo member add "$A" --role viewer -R "$R" --json role
trunk() { $V uvw inspect range A1:B2 --trunk --unit "$U" --worksheet index:1 --json | jq -c '[.. | objects | select(has("v")) | .v]'; }
trash() { curl -sS -b "$TG/$1.cookies" -o "$EVIDENCE/$2.json" -w '%{http_code}\n' -X "$3" "$ORIGIN/api/trash-batches/$B$4"; }
```

### TG1. A Viewer agent has no route onto Trunk

Run: helper.

A, a Viewer of R, posts an edit and a restore to revision 1 on the realtime route, then restores and deletes B with
its own session. A2.7 asks that every direct path to Trunk refuse a Viewer agent. [PR6](pull-requests.md#pr6-refusals)
shows the uvw and MCP routes refuse a Viewer.

```bash
trunk > "$EVIDENCE/tg1-before.json"
node "$TC" "$TG/agent.cookies" "$U" sheet.mutation.set-range-values '{"cellValue":{"1":{"1":{"v":99}}}}' > "$EVIDENCE/tg1-edit.json"
node "$TC" "$TG/agent.cookies" "$U" univer.mutation.revert-version '{"revision":1}' > "$EVIDENCE/tg1-restore.json"
jq -s -e 'map(.event) == ["permission_rej", "permission_rej"] and map(.baseRev) == [2, 2]' "$EVIDENCE/tg1-edit.json" "$EVIDENCE/tg1-restore.json"
{ trash agent tg1-trash-restore POST /restore; trash agent tg1-trash-delete DELETE; } > "$EVIDENCE/tg1-trash.status"
test "$(tr '\n' ' ' < "$EVIDENCE/tg1-trash.status")" = "404 404 "
jq -s -e 'map(.error.code) == ["NOT_FOUND", "NOT_FOUND"]' "$EVIDENCE/tg1-trash-restore.json" "$EVIDENCE/tg1-trash-delete.json"
trunk > "$EVIDENCE/tg1-after.json"
cmp "$EVIDENCE/tg1-before.json" "$EVIDENCE/tg1-after.json"
jq -e '. == ["Region", "Total", "North", 41]' "$EVIDENCE/tg1-after.json"
```

Pass when the edit and the restore both get `permission_rej` at head 2, both Trash calls answer 404 `NOT_FOUND`, and
Trunk still reads Region, Total, North, 41.

### TG2. The SDK's Unit remove and recover routes refuse every client

Run: helper.

The Collaboration SDK serves `DELETE /universer-api/snapshot/-/units` and `POST /universer-api/snapshot/-/units/recover`
to any signed-in caller. A, a Viewer, and O, the owner, each call both for `Sales`, the first with `hardDelete=true`.

```bash
for who in agent owner; do
  curl -sS -b "$TG/$who.cookies" -o "$EVIDENCE/tg2-$who-remove.json" -w '%{http_code}\n' -X DELETE "$ORIGIN/universer-api/snapshot/-/units?unitIds=$U&hardDelete=true"
  curl -sS -b "$TG/$who.cookies" -o "$EVIDENCE/tg2-$who-recover.json" -w '%{http_code}\n' -X POST "$ORIGIN/universer-api/snapshot/-/units/recover" \
    -H 'content-type: application/json' -d "{\"unitIds\":[\"$U\"]}"
done > "$EVIDENCE/tg2.status"
test "$(tr '\n' ' ' < "$EVIDENCE/tg2.status")" = "403 403 403 403 "
jq -s -e 'map(.error) | unique == [{code: 3, message: "Units are removed and recovered through the product API."}]' \
  "$EVIDENCE/tg2-agent-remove.json" "$EVIDENCE/tg2-agent-recover.json" "$EVIDENCE/tg2-owner-remove.json" "$EVIDENCE/tg2-owner-recover.json"
trunk > "$EVIDENCE/tg2-after.json"
jq -e '. == ["Region", "Total", "North", 41]' "$EVIDENCE/tg2-after.json"
```

Pass when all four calls answer 403 with code 3, `PERMISSION_DENIED`, and the message above, and O still reads
`Sales` on Trunk.

### TG3. An agent that lands by checks changes Trunk only by a merge

Run: helper.

O makes A an Editor and turns on `landing` `checks`. A does not own R, so it may change R's files only by merging a
pull request whose checks passed. [MP17](agent-mode-checks.md#mp17-a-repository-that-requires-checks) shows its Blob,
Trash and rename refusals and its Browser opening Trunk read-only. Here A posts an edit and a restore on the realtime
route and restores and deletes B. Back in `review`, the same edit commits.

```bash
$V cli tg3-editor repo member edit "$A" --role editor -R "$R" --json role
$V cli tg3-checks repo edit "$R" --landing checks --json landing
jq -e '.landing == "checks"' "$EVIDENCE/tg3-checks.out"
trunk > "$EVIDENCE/tg3-before.json"
node "$TC" "$TG/agent.cookies" "$U" sheet.mutation.set-range-values '{"cellValue":{"1":{"1":{"v":42}}}}' > "$EVIDENCE/tg3-edit.json"
node "$TC" "$TG/agent.cookies" "$U" univer.mutation.revert-version '{"revision":1}' > "$EVIDENCE/tg3-restore.json"
jq -s -e 'map(.event) == ["permission_rej", "permission_rej"] and (map(.baseRev) | unique | length == 1)' "$EVIDENCE/tg3-edit.json" "$EVIDENCE/tg3-restore.json"
{ trash agent tg3-trash-restore POST /restore; trash agent tg3-trash-delete DELETE; } > "$EVIDENCE/tg3-trash.status"
test "$(tr '\n' ' ' < "$EVIDENCE/tg3-trash.status")" = "403 403 "
jq -s -e 'map(.error.code) == ["AGENT_NOT_ALLOWED", "AGENT_NOT_ALLOWED"] and (.[0].error.message | startswith("This repository requires checks"))' \
  "$EVIDENCE/tg3-trash-restore.json" "$EVIDENCE/tg3-trash-delete.json"
trunk > "$EVIDENCE/tg3-after.json"
cmp "$EVIDENCE/tg3-before.json" "$EVIDENCE/tg3-after.json"
$V cli tg3-review repo edit "$R" --landing review --json landing
node "$TC" "$TG/agent.cookies" "$U" sheet.mutation.set-range-values '{"cellValue":{"1":{"1":{"v":42}}}}' > "$EVIDENCE/tg3-edit-review.json"
jq -e '.event == "changeset_ack"' "$EVIDENCE/tg3-edit-review.json"
trunk > "$EVIDENCE/tg3-review.json"
jq -e '. == ["Region", "Total", "North", 42]' "$EVIDENCE/tg3-review.json"
```

Pass when, with `checks` on, A's edit and restore get `permission_rej` at one head, its Trash restore and delete answer
403 `AGENT_NOT_ALLOWED`, and Trunk is unchanged; and in `review` the same edit commits and B2 reads 42.

### TG4. A restore from history needs Edit on every protected range

Run: helper.

A is an Editor in `review` and restores `Sales` to revision 1, which an Editor may do on an unprotected Sheet. O then
protects B2 so that only O edits it, as the Browser's range protection does. A's restore to the revision that added the
protection is refused, because it would replace B2. O's same restore commits, and B2 stays protected.

```bash
$V cli tg4-editor repo member edit "$A" --role editor -R "$R" --json role
$V cli tg4-review repo edit "$R" --landing review --json landing
node "$TC" "$TG/agent.cookies" "$U" univer.mutation.revert-version '{"revision":1}' > "$EVIDENCE/tg4-restore-open.json"
jq -e '.event == "changeset_ack"' "$EVIDENCE/tg4-restore-open.json"
trunk > "$EVIDENCE/tg4-restored.json"
jq -e '. == ["Region", "Total", "North", 40]' "$EVIDENCE/tg4-restored.json"
curl --fail-with-body -sS -b "$TG/owner.cookies" -o "$EVIDENCE/tg4-protection.json" -X POST "$ORIGIN/universer-api/authz/3/object" -H 'content-type: application/json' \
  -d "{\"objectType\":3,\"selectRangeObject\":{\"unitID\":\"$U\",\"name\":\"B2\",\"collaborators\":[],\"scope\":{\"read\":1,\"edit\":2}}}"
P=$(jq -r .objectID "$EVIDENCE/tg4-protection.json")
node "$TC" "$TG/owner.cookies" "$U" sheet.mutation.add-range-protection \
  "{\"rules\":[{\"id\":\"tg4-b2\",\"permissionId\":\"$P\",\"unitId\":\"$U\",\"unitType\":3,\"ranges\":[{\"startRow\":1,\"endRow\":1,\"startColumn\":1,\"endColumn\":1}],\"viewState\":\"othersCanView\",\"editState\":\"onlyMe\"}]}" \
  > "$EVIDENCE/tg4-protect.json"
jq -e '.event == "changeset_ack"' "$EVIDENCE/tg4-protect.json"
PROTECTED=$(( $(jq -r .baseRev "$EVIDENCE/tg4-protect.json") + 1 ))
node "$TC" "$TG/agent.cookies" "$U" sheet.mutation.set-range-values '{"cellValue":{"1":{"1":{"v":7}}}}' > "$EVIDENCE/tg4-edit-b2.json"
node "$TC" "$TG/agent.cookies" "$U" sheet.mutation.set-range-values '{"cellValue":{"0":{"0":{"v":"Area"}}}}' > "$EVIDENCE/tg4-edit-a1.json"
jq -s -e 'map(.event) == ["permission_rej", "changeset_ack"]' "$EVIDENCE/tg4-edit-b2.json" "$EVIDENCE/tg4-edit-a1.json"
node "$TC" "$TG/agent.cookies" "$U" univer.mutation.revert-version "{\"revision\":$PROTECTED}" > "$EVIDENCE/tg4-restore-agent.json"
jq -e '.event == "permission_rej"' "$EVIDENCE/tg4-restore-agent.json"
trunk > "$EVIDENCE/tg4-refused.json"
jq -e '. == ["Area", "Total", "North", 40]' "$EVIDENCE/tg4-refused.json"
node "$TC" "$TG/owner.cookies" "$U" univer.mutation.revert-version "{\"revision\":$PROTECTED}" > "$EVIDENCE/tg4-restore-owner.json"
jq -e '.event == "changeset_ack"' "$EVIDENCE/tg4-restore-owner.json"
trunk > "$EVIDENCE/tg4-owner.json"
jq -e '. == ["Region", "Total", "North", 40]' "$EVIDENCE/tg4-owner.json"
node "$TC" "$TG/agent.cookies" "$U" sheet.mutation.set-range-values '{"cellValue":{"1":{"1":{"v":8}}}}' > "$EVIDENCE/tg4-edit-b2-after.json"
jq -e '.event == "permission_rej"' "$EVIDENCE/tg4-edit-b2-after.json"
```

Pass when A's first restore commits and B2 reads 40; with B2 protected, A's write to B2 is refused and its write to A1
commits; A's restore gets `permission_rej` and A1 still reads `Area`; O's same restore commits and A1 reads `Region`;
and A's write to B2 is still refused.

## Gotchas

- A changeset commits or is refused on the realtime socket, not in the HTTP answer to `new_changes`, which only
  acknowledges receipt. `trunk-changeset.mjs` waits for the socket and prints `changeset_ack`, `permission_rej` or the
  SDK's other event names.
- A restore commits only at head. `trunk-changeset.mjs` reads head from the snapshot route, whose stored snapshot can
  lag; the changesets after it reach head.
- A Viewer's Trash calls answer 404, because a Viewer cannot see the Space's Trash. That 404 would come without the
  guard too, so TG1's Trash calls show only that a Viewer cannot see Trash. TG3 proves the guard: it answers
  `AGENT_NOT_ALLOWED` before it looks the Trash Batch up.
