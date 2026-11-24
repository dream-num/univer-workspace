# Skills and the Facade API reference over MCP

An agent lists and reads the built-in, personal and repository Skills, reads Skill files as MCP resources,
searches and pages through the Facade API reference, reads the server instructions, and writes or imports Skill
drafts that a person reviews and publishes.

## Sub-features

- MR1 lists the twelve MCP Skills and compares shared get/full content with its source.
- MR2 reads a shared Skill resource through `skills_read`, checks MCP read instructions, and confirms MCP core differs from CLI core.
- MR3 and MR4 search and show Facade API symbols against the CLI and the reference library.
- MR5 lists and reads Skill files as MCP resources against the CLI.
- MR6 checks the server instructions in the initialize result in both protocols, including the new-key-per-operation rule.
- MR7 reads a long class through `api_show` cursors and compares the pages with the reference library.
- MR8 rejects a cursor reused with other arguments and an unknown Skill.
- MR13 seeds personal and repository custom Skills and checks discovery sources, metadata, duplicate diagnostics and repository event attribution.
- MR14 creates a Skill draft through MCP, publishes through an interactive HTTP Session, and reads the new Skill.
- MR15 imports a pinned external Skill from GitHub as a draft and publishes it after browser review.

## How to get to it (user POV)

An MCP client connected to `$MCP_URL` reads the initialize instructions, calls `skills_read`, `api_find` and
`api_show`, and lists and reads resources. The CLI shows the same content through `uvw skills get`,
`uvw api find` and `uvw api show`.

## Driving it with agent-browser and uvw

Mode: mcp.

Start every shell with `eval "$($V env)"`. Each `$V mcp`
call checks its usage event and credential leakage, and exit 5 fails the journey.
[MCP mode](../references/mcp-mode.md) lists the helper commands and their exit codes.

### MR1. Skills list and get fallback

MCP serves its own `core`, `html-view-creator` and `skill-creator` and nine
shared domain Skills.

```bash
REF='const {createRequire}=require("node:module");const r=createRequire(process.cwd()+"/apps/mcp/package.json")("@univer-cli/api-reference").createStandardApiReference();'
$V mcp mcp-skills-list skills_read
jq -e '[.skills[].name] == ["base","blob","board","core","cross-unit-formula","doc","embed","html-view-creator","html-view","sheet","skill-creator","slide"] and all(.skills[]; (.description | length) > 0)' "$EVIDENCE/mcp-skills-list.out"
$V mcp mcp-skills-get skills_read '{"name":"html-view"}'
$V mcp mcp-skills-full skills_read '{"name":"board","full":true}'
test $? -eq 1
jq -e '.code == "workspace-result-too-large"' "$EVIDENCE/mcp-skills-full.out"
jq -e '.outcome == "tool_error" and .error_code == "workspace-result-too-large"' "$EVIDENCE/mcp-skills-full.event.json"
$V mcp mcp-skills-doc-full skills_read '{"name":"doc","full":true}'
node --input-type=module - "$EVIDENCE/mcp-skills-get.out" "$EVIDENCE/mcp-skills-doc-full.out" <<'JS'
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const get = JSON.parse(readFileSync(process.argv[2], 'utf8'));
assert.equal(get.content, readFileSync('apps/cli/skill-data/html-view/SKILL.md', 'utf8'));
const skill = JSON.parse(readFileSync(process.argv[3], 'utf8'));
const root = 'apps/cli/skill-data/doc/';
assert.equal(skill.content, readFileSync(root + 'SKILL.md', 'utf8'));
assert.ok(skill.files.length > 0);
assert.equal(skill.files.length, skill.resources.length);
for (const file of skill.files) assert.equal(file.content, readFileSync(root + file.path, 'utf8'));
JS
```

Pass when the fallback lists twelve names with descriptions, `html-view` get preserves
its source, and `board` full, whose `references/` files exceed the 100,000-character result limit,
exits 1 with `workspace-result-too-large` in the result and event. Doc full must exit 0 and preserve
every shared file.

### MR2. Skill resource and MCP core bindings

```bash
$V mcp mcp-skills-read skills_read '{"name":"html-view","resource":"references/charts.md"}'
node -e 'const fs=require("node:fs");process.stdout.write(JSON.parse(fs.readFileSync(process.argv[1])).content)' "$EVIDENCE/mcp-skills-read.out" > "$EVIDENCE/mcp-skills-read.md"
cmp "$EVIDENCE/mcp-skills-read.md" apps/cli/skill-data/html-view/references/charts.md
jq -e '.resources | length > 0 and all(.[]; .readCommand | startswith("Call skills_read with name \"html-view\" and resource \""))' "$EVIDENCE/mcp-skills-get.out"
$V mcp mcp-skills-core skills_read '{"name":"core"}'
node -e 'const fs=require("node:fs");process.stdout.write(JSON.parse(fs.readFileSync(process.argv[1])).content)' "$EVIDENCE/mcp-skills-core.out" > "$EVIDENCE/mcp-skills-core.md"
cmp "$EVIDENCE/mcp-skills-core.md" apps/mcp/skills/core/SKILL.md
! cmp -s "$EVIDENCE/mcp-skills-core.md" apps/cli/skill-data/core/SKILL.md
! rg -n '\buvw\b' "$EVIDENCE/mcp-skills-core.md"
jq -e '.tool == "skills_read" and .outcome == "ok"' "$EVIDENCE/mcp-skills-read.event.json"
```

Pass when the reference equals the shared source, read instructions name MCP calls, and MCP core equals its own source and differs from CLI core.

### MR3. API find

The CLI `api` commands print text and have no `--json`, so the reference library (the same package the CLI loads) is the structured oracle, and the CLI text is the cross-check.

```bash
$V mcp mcp-api-find api_find '{"terms":["setValues","conditionalformat"],"unit":"sheet"}'
node -e "$REF"'console.log(JSON.stringify({results:r.find({terms:["setValues","conditionalformat"],unit:"sheet"})}))' > "$EVIDENCE/mcp-api-find-oracle.json"
diff <(jq -S . "$EVIDENCE/mcp-api-find.out") <(jq -S . "$EVIDENCE/mcp-api-find-oracle.json")
$V cli mcp-api-find-cli api find setValues --unit sheet
grep -qF "$(jq -r '.results[0].matches[0].label | split("(")[0]' "$EVIDENCE/mcp-api-find.out")" "$EVIDENCE/mcp-api-find-cli.out"
$V mcp mcp-api-find-bad api_find '{"terms":["x"],"unit":"nope"}'
test $? -eq 1
jq -e '.code == "workspace-argument-invalid"' "$EVIDENCE/mcp-api-find-bad.out"
```

Pass when the result equals the library output (wrapped in `results`), the CLI text contains the first match, and an unknown unit is `workspace-argument-invalid` with exit 1.

### MR4. API show

```bash
$V mcp mcp-api-show api_show '{"symbols":["FRange.setValues","ICellData.v","NoSuchSymbolAnywhere"]}'
node -e "$REF"'console.log(JSON.stringify({results:r.show(["FRange.setValues","ICellData.v","NoSuchSymbolAnywhere"])}))' > "$EVIDENCE/mcp-api-show-oracle.json"
diff <(jq -S . "$EVIDENCE/mcp-api-show.out") <(jq -S . "$EVIDENCE/mcp-api-show-oracle.json")
jq -e '.results[2].status == "not-found" and (.truncated | not)' "$EVIDENCE/mcp-api-show.out"
$V cli mcp-api-show-cli api show FRange.setValues
grep -q 'declare class FRange' "$EVIDENCE/mcp-api-show-cli.out"
grep -q 'setValues' "$EVIDENCE/mcp-api-show-cli.out"
$V cli mcp-api-show-missing-cli api show NoSuchSymbolAnywhere
test $? -eq 1
grep -q 'Unknown symbol: NoSuchSymbolAnywhere' "$EVIDENCE/mcp-api-show-missing-cli.err"
```

Pass when the result equals the library output, an unknown symbol is a `not-found` entry and not a tool error, the CLI text shows the same class and member, and the CLI exits 1 for the unknown symbol (the gateway reports it in the result instead).

### MR5. MCP Skills extension and file resources

```bash
$V mcp-skills mcp-skills-extension
jq -e '.supported and (.extensions | has("io.modelcontextprotocol/skills")) and (.skills | length == 12) and all(.skills[]; (.resources | type == "array") and all(.resources[]; (.uri | startswith("skill://univer-workspace/")) and (.digest | test("^sha256:[a-f0-9]{64}$"))))' "$EVIDENCE/mcp-skills-extension.out"
diff <(jq -r '.skills[].frontmatter.name' "$EVIDENCE/mcp-skills-extension.out") <(jq -r '.skills[].name' "$EVIDENCE/mcp-skills-list.out")
$V mcp-resources mcp-resources-list
diff <(jq -r '.[].uri' "$EVIDENCE/mcp-resources-list.out" | sort) <(jq -r '.skills[].uri' "$EVIDENCE/mcp-skills-extension.out" | sort)
jq -e 'all(.[]; .mimeType == "text/markdown")' "$EVIDENCE/mcp-resources-list.out"
for n in core html-view-creator skill-creator; do
  $V mcp-resource "mcp-resource-$n" "skill://univer-workspace/$n/SKILL.md"
  node -e 'const fs=require("node:fs");process.stdout.write(JSON.parse(fs.readFileSync(process.argv[1]))[0].text)' "$EVIDENCE/mcp-resource-$n.out" > "$EVIDENCE/mcp-resource-$n.md"
  cmp "$EVIDENCE/mcp-resource-$n.md" "apps/mcp/skills/$n/SKILL.md"
done
for n in base blob board cross-unit-formula doc embed html-view sheet slide; do
  $V mcp-resource "mcp-resource-$n" "skill://univer-workspace/$n/SKILL.md"
  node -e 'const fs=require("node:fs");process.stdout.write(JSON.parse(fs.readFileSync(process.argv[1]))[0].text)' "$EVIDENCE/mcp-resource-$n.out" > "$EVIDENCE/mcp-resource-$n.md"
  cmp "$EVIDENCE/mcp-resource-$n.md" "apps/cli/skill-data/$n/SKILL.md"
done
$V mcp-resource mcp-resource-ref skill://univer-workspace/html-view/references/charts.md
diff <(jq -r '.[0].text' "$EVIDENCE/mcp-resource-ref.out") <(jq -r '.content' "$EVIDENCE/mcp-skills-read.out")
$V mcp-resource --protocol 2025-11-25 mcp-resource-core-legacy skill://univer-workspace/core/SKILL.md
diff "$EVIDENCE/mcp-resource-core.out" "$EVIDENCE/mcp-resource-core-legacy.out"
$V mcp-resources --toolsets admin mcp-resources-admin
diff "$EVIDENCE/mcp-resources-list.out" "$EVIDENCE/mcp-resources-admin.out"
$V mcp-resource mcp-resource-missing skill://univer-workspace/core/references/missing.md
test $? -eq 3
```

Pass when the extension declares twelve static Skills, the resource entry points match the catalog, MCP core, `html-view-creator` and `skill-creator` equal their sources in `apps/mcp/skills`, all nine shared Skills equal their sources, both protocols read the same core, and admin connections expose the same catalog. Unknown resources exit 3. Resource and extension calls have no tool event file.

### MR6. Server instructions

```bash
$V mcp-instructions mcp-instructions
$V mcp-instructions --protocol 2025-11-25 mcp-instructions-legacy
diff "$EVIDENCE/mcp-instructions.out" "$EVIDENCE/mcp-instructions-legacy.out"
jq -e '.instructions | contains("pull request") and contains("pr_create") and contains("pr_ready") and contains("api_find") and contains("skills_read") and contains("review") and contains("The user granted this connection the worktree:merge scope") and contains("Otherwise, merge it with pr_merge.") and contains("Generate a new random value, such as a UUID, for each new operation.")' "$EVIDENCE/mcp-instructions.out"
```

Pass when both protocols return the same non-null `instructions` that name the workflow (find the file, open a pull request, verify by reading back, mark ready, then merge, or hand over the review link when the user asked to review) and tell the agent to generate a new idempotency key for each new operation. The default PAT holds `worktree:merge`; MA7 checks the instructions of a PAT without it.

### MR7. Truncation with cursors

`FRange` is about 170,000 characters, so `api_show` pages it. No shipped skill file exceeds the limit, so `skills_read` resource paging is covered by the gateway tests. MR1 covers `workspace-result-too-large` with `board` full.

```bash
CURSOR=""; I=0
while :; do
  ARGS=$(jq -nc --arg c "$CURSOR" '{symbols:["FRange"]} + (if $c == "" then {} else {cursor:$c} end)')
  $V mcp "mcp-frange-$I" api_show "$ARGS"
  CURSOR=$(jq -r '.cursor // ""' "$EVIDENCE/mcp-frange-$I.out")
  I=$((I+1))
  [ -n "$CURSOR" ] || break
done
test "$I" -gt 1
node -e "$REF"'console.log(JSON.stringify(r.show(["FRange"])[0]))' > "$EVIDENCE/mcp-frange-oracle.json"
for f in "$EVIDENCE"/mcp-frange-[0-9]*.out; do jq -e '(tojson | length) <= 100000' "$f"; done
jq -e '.truncated == true and (.cursor | type == "string")' "$EVIDENCE/mcp-frange-0.out"
jq -e '(.truncated | not) and (.cursor | not)' "$EVIDENCE/mcp-frange-$((I-1)).out"
diff <(jq -s -S '[.[].results[0].groups[].members[]]' "$EVIDENCE"/mcp-frange-[0-9]*.out) <(jq -S '[.groups[].members[]]' "$EVIDENCE/mcp-frange-oracle.json")
diff <(jq -S '.results[0] | del(.groups)' "$EVIDENCE/mcp-frange-0.out") <(jq -S 'del(.groups)' "$EVIDENCE/mcp-frange-oracle.json")
$V cli mcp-frange-cli api show FRange
for name in $(jq -r '.groups[].members[].name' "$EVIDENCE/mcp-frange-oracle.json" | sort -u | head -n 40); do grep -qF "$name" "$EVIDENCE/mcp-frange-cli.out"; done
```

Pass when the pages are each within 100,000 characters, all but the last carry `truncated` and `cursor`, the members concatenated across pages equal the reference library's members in order, every page repeats the same class header, and the CLI text names the sampled members.

### MR8. Cursor guard and unknown Skill

```bash
$V mcp mcp-frange-wrong api_show "$(jq -nc --arg c "$(jq -r '.cursor' "$EVIDENCE/mcp-frange-0.out")" '{symbols:["FWorkbook"],cursor:$c}')"
test $? -eq 1
jq -e '.code == "workspace-argument-invalid"' "$EVIDENCE/mcp-frange-wrong.out"
jq -e '.error_code == "workspace-argument-invalid" and .outcome == "tool_error"' "$EVIDENCE/mcp-frange-wrong.event.json"
$V mcp mcp-skills-unknown skills_read '{"name":"no-such-skill"}'
test $? -eq 1
$V cli mcp-skills-unknown-cli skills get no-such-skill --json
test $? -eq 1
jq -e '.code == "workspace-argument-invalid"' "$EVIDENCE/mcp-skills-unknown.out"
```

Pass when a cursor reused with other symbols and an unknown Skill both return `workspace-argument-invalid` with exit 1, the reused cursor has a matching usage event, and the CLI also rejects the unknown Skill.
### MR13. custom Skills

Seed one Skill in each layer.
Run MR13 after MR1 or on a fresh run: MR1 expects only the twelve built-in Skills.
The seeder creates missing folders and uploads files recursively. Re-runs skip existing
Blob names and never delete or replace existing data. Use a new name to seed changed bytes.

```bash
eval "$($V env)"
O="verify-$VERIFY_UVW_RUN"
$V cli sk1-repo repo create sk1-skills --json
mkdir -p "$EVIDENCE/sk1-user-source/references" "$EVIDENCE/sk1-repo-source/scripts"
cat > "$EVIDENCE/sk1-user-source/SKILL.md" <<'SKILL'
---
name: weekly-report
description: Write the weekly report from the current repository.
---
Read the source data before writing the report.
SKILL
cat > "$EVIDENCE/sk1-repo-source/SKILL.md" <<'SKILL'
---
name: reconcile-ledger
description: Reconcile the repository ledger.
metadata:
  source: https://example.com/skills/reconcile-ledger
  source-commit: abc123
---
Read the ledger and report unmatched entries.
SKILL
printf 'Check every source.\n' > "$EVIDENCE/sk1-user-source/references/guide.md"
printf 'export const ledger = true;\n' > "$EVIDENCE/sk1-repo-source/scripts/check.js"
node .agents/skills/verify-uvw/bin/seed-skills.mjs "$O/personal" weekly-report "$EVIDENCE/sk1-user-source" > "$EVIDENCE/sk1-seed-user.json"
node .agents/skills/verify-uvw/bin/seed-skills.mjs "$O/sk1-skills" reconcile-ledger "$EVIDENCE/sk1-repo-source" > "$EVIDENCE/sk1-seed-repo.json"
$V mcp sk1-list skills_read "{\"repo\":\"$O/sk1-skills\"}"
jq -e '([.skills[].source] | unique) == ["builtin","repository","user"] and .repository == "loaded" and .diagnostics == []' "$EVIDENCE/sk1-list.out"
jq -e --slurpfile repo "$EVIDENCE/sk1-repo.out" '.outcome == "ok" and .repo == $repo[0].id' "$EVIDENCE/sk1-list.event.json"
$V mcp sk1-user-read skills_read '{"name":"weekly-report"}'
jq -e '.source == "user" and [.resources[].path] == ["references/guide.md"]' "$EVIDENCE/sk1-user-read.out"
$V mcp sk1-repo-read skills_read "{\"repo\":\"$O/sk1-skills\",\"name\":\"reconcile-ledger\"}"
jq -e '.source == "repository" and [.resources[].path] == ["scripts/check.js"]' "$EVIDENCE/sk1-repo-read.out"
node .agents/skills/verify-uvw/bin/seed-skills.mjs "$O/sk1-skills" reconcile-ledger "$EVIDENCE/sk1-repo-source" > "$EVIDENCE/sk1-seed-repeat.json"
jq -e '.uploaded == 0 and .skipped == 2' "$EVIDENCE/sk1-seed-repeat.json"
jq -e '.skills[] | select(.name == "reconcile-ledger") | .metadata == {source: "https://example.com/skills/reconcile-ledger", "source-commit": "abc123"}' "$EVIDENCE/sk1-list.out"
jq -e '.skills[] | select(.name == "weekly-report") | has("metadata") | not' "$EVIDENCE/sk1-list.out"
$V cli sk1-repo-agents space browse "$O/sk1-skills" --json
AGENTS=$(jq -r '.nodes[] | select(.name == ".agents") | .nodeId' "$EVIDENCE/sk1-repo-agents.out")
$V cli sk1-repo-skills space browse "$O/sk1-skills" --parent "$AGENTS" --json
SKILLS=$(jq -r '.nodes[] | select(.name == "skills") | .nodeId' "$EVIDENCE/sk1-repo-skills.out")
$V cli sk1-duplicate-create space node create "$O/sk1-skills" --parent "$SKILLS" --name reconcile-ledger --json
$V mcp sk1-duplicate skills_read "{\"repo\":\"$O/sk1-skills\"}"
jq -e '.diagnostics == [{source: "repository", path: ".agents/skills/reconcile-ledger", problem: "duplicate"}] and ([.skills[] | select(.name == "reconcile-ledger")] | length == 0) and any(.skills[]; .name == "weekly-report" and .source == "user")' "$EVIDENCE/sk1-duplicate.out"
```

Pass when `sk1-list.out` contains `builtin`, `user` and `repository` sources,
`repository` is `loaded`, and `diagnostics` is empty. Its event must have outcome `ok`
and repo equal to `.id` in `sk1-repo.out`. By-name reads must return their source and
text resource manifests. The repeated seed must skip both files without uploading.
The repository entry must preserve the frontmatter `metadata` string map, and the personal entry
must omit `metadata`. Creating the second `reconcile-ledger` folder must produce exactly one
`duplicate` diagnostic with repository source and the ambiguous folder path. The repository
Skill disappears while the personal Skill remains. Duplicate `.agents`, `skills` and `SKILL.md`
names follow the same rule at their respective paths and skip the ambiguous subtree.
Dot-named nested folders and `blob upload --parent` are exercised by these uploads.
Use a fresh run for the duplicate case because it intentionally leaves an ambiguous folder.

### MR14. Skill draft authoring

MR14 follows MR13's live custom Skill discovery path.

```bash
eval "$($V env)"
node .agents/skills/verify-uvw/bin/mcp-skill-draft.mjs
```

Pass when `mr14-create.out` and `mr14-retry.out` return the same pending draft and
an absolute identity-origin preview URL. `mr14-pending.out` must say `pending`, and
`mr14-before.out` must not list the Skill. The script signs in through the password
login HTTP endpoint to obtain the author's interactive Session. It publishes with
`POST /api/skill-drafts/{id}/publish`, saves status 200 and state `published` in
`mr14-publish.json`, and signs that Session out. No credential is saved to evidence.
`mr14-published.out` must say `published`. `mr14-list.out` must list the new Skill
with source `user`, and `mr14-read.out` must return its exact `SKILL.md` text.
The four draft call events must say `ok`, `executor: none`, and the destination
Space ID, with no Skill content. `mr14-summary.json` records the asserted result.

### MR15. Import a pinned external Skill and publish after review

Mode: mcp-same-origin.

It needs live GitHub network access.

```bash
eval "$($V env)"
$V doctor > "$EVIDENCE/mr15-doctor.txt"
node .agents/skills/verify-uvw/bin/mcp-skill-import.mjs
```

The script reads the real pinned
`anthropics/skills` PDF Skill, creates an as-is `from` draft with one verbatim review
quote and one fabricated quote, signs into the browser, captures the review page,
and presses Publish on that page. It then independently checks publication through
`skill_draft_get` and `skills_read`. It never writes a shared Skill folder itself.
The run must be fresh because publication creates `pdf` in the Personal Space.

Pass when `mr15-source.out` includes `script-file`, `mr15-create.out` includes the
pinned source, one verified review with its line and `unverifiedReviewCount: 1`, and
`mr15-draft.png` shows those findings, the source link and script files. The script
checks the rendered source link, quote, line and warning text before taking the
screenshot. `mr15-published.png` and `mr15-published-status.out` show publication;
`mr15-list.out` includes `pdf` with `metadata.source-hub: github` and its pinned
commit. `mr15-ratelimit-before.json` and `mr15-ratelimit-after.json` preserve the real
GitHub `x-ratelimit-remaining` headers. All per-call outputs, events and redacted logs
are retained by the MCP helper. `mr15-summary.json` records the assertions.

For the rail proof, follow AS1 in [Agent Skills](agent-skills.md) to configure the
existing local scripted provider with one text acknowledgement. This scripts only
the model response; source resolution, copying, scanning, publication and catalog
reads use the real services and live GitHub. Send a new message from Home after
publication. Verify `pdf` is first in the Skills rail and its `from GitHub` link
is derived from `metadata.source` and its pinned `source-commit`. Save `mr15-rail.png` and `mr15-rail.txt`, reload and save
`mr15-rail-reloaded.png` to check persistence. Switch the UI to Chinese and save
`mr15-rail-zh.png` showing `来自 GitHub`. No real model credentials are required.

## Gotchas

- The MCP-mode gotchas in [MCP gateway](mcp.md#gotchas) apply.
