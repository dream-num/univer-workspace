# Browser Agent skills

Users teach the browser Agent with personal and repository `.agents/skills/<name>/SKILL.md`
files. The rail shows available and used skills. A user can invoke a skill with `/name`,
and the model can read instructions on demand without changing earlier request prefixes.

## Sub-features

- AS1 configures a local mock model through Model settings.
- AS2 checks the first repository catalog in the rail and model request.
- AS3 expands and collapses more than three skills.
- AS4 marks a model-read skill as used and moves it first.
- AS5 keeps the second turn free of redundant reminders and preserves the prefix.
- AS6 replaces the catalog after a skill is added between turns.
- AS7 switches from global to repository scope without changing the system message.
- AS8 excludes a public repository's skills for a non-member.
- AS9 shows shadowed, reserved-name, and invalid-skill diagnostics with paths.
- AS10 drives the slash menu and its combobox attributes in both composers.
- AS11 expands explicit invocations and their arguments into a user reminder.
- AS12 repeats an invocation with new arguments and a short reminder.
- AS13 permits explicit manual-only invocation and resource reads, but denies model invocation.
- AS14 hides model-only skills from the menu while allowing model reads.
- AS15 queues slash text as steering while a slow model step runs.

## How to get to it (user POV)

Sign in, click **Agents** in the top bar, and open **Model settings**. A repository's
**Agents** tab starts a repository session. The global composer is on **Home** after
clicking the top-bar **Agents** button. Send a message to open a session with the
follow-up composer and a **Skills** section in the session rail.

## Driving it with agent-browser and uvw

Use Bash in one persistent shell so the instance and mock processes survive. Run
[MR1](mcp.md) before seeding custom skills. The commands below share one fresh run and
use distinct names for each journey. A journey that continues another session says so.
Install and build the prerequisites in [the skill](../SKILL.md#launch) first.

```bash
export VERIFY_UVW_ROOT=/tmp/verify-uvw-as VERIFY_UVW_RUN=as
export VERIFY_UVW_SERVER_PORT=3927 VERIFY_UVW_WEB_PORT=5980 VERIFY_UVW_MCP_PORT=3937
export VERIFY_UVW_MCP=1 VERIFY_UVW_MCP_SAME_ORIGIN=1
V=.agents/skills/verify-uvw/bin/verify-uvw
$V up
$V user
eval "$($V env)"
$V doctor > "$EVIDENCE/as-doctor.txt"
$V cli as-repo repo create as-skills --json
```

Define these shell helpers. `mock` stops only the provider it started. Keep each label
unique because the provider appends to its request log. `send` and `follow` wait for the
composer to clear. Each journey also waits for its final mock response before checking.

```bash
B=.agents/skills/verify-uvw/bin
A=$B/agent-requests.mjs
RUN="${VERIFY_UVW_ROOT:-/tmp/verify-uvw}/$VERIFY_UVW_RUN"
O="verify-$VERIFY_UVW_RUN"
REPO="$O/as-skills"
SPACE=$($V uvw repo view "$REPO" --json id | jq -r .id)
MODEL_PORT=5986
while lsof -nP -iTCP:"$MODEL_PORT" -sTCP:LISTEN >/dev/null; do MODEL_PORT=$((MODEL_PORT + 1)); done
seed() {
  local repo="$1" name="$2" body="$3" extra="${4:-}"
  local dir="$EVIDENCE/sources/$name"
  mkdir -p "$dir"
  printf -- '---\nname: %s\ndescription: Verify %s.\nargument-hint: "[topic]"\n%b---\n%s\n' "$name" "$name" "$extra" "$body" > "$dir/SKILL.md"
  node "$B/seed-skills.mjs" "$repo" "$name" "$dir"
}
mock() {
  if [ -n "${MODEL_PID:-}" ]; then kill "$MODEL_PID"; wait "$MODEL_PID" || true; fi
  local label="$1" steps="$2"
  jq -n --argjson steps "$steps" '{model:"mock-agent",steps:$steps}' > "$EVIDENCE/$label-script.json"
  node "$B/mock-provider.mjs" --port "$MODEL_PORT" --script "$EVIDENCE/$label-script.json" --log "$EVIDENCE/$label-requests.jsonl" > "$EVIDENCE/$label-provider.log" 2>&1 &
  MODEL_PID=$!
  for n in $(seq 1 50); do curl -fsS "http://127.0.0.1:$MODEL_PORT/models" >/dev/null 2>&1 && break; sleep 0.1; done
  kill -0 "$MODEL_PID"
}
shot() { agent-browser snapshot -c > "$EVIDENCE/$1.txt"; agent-browser screenshot "$EVIDENCE/$1.png"; }
aria() {
  agent-browser eval 'Array.from(document.querySelectorAll("[contenteditable=true],textarea")).map(e=>({role:e.getAttribute("role"),expanded:e.getAttribute("aria-expanded"),active:e.getAttribute("aria-activedescendant"),text:e.tagName === "TEXTAREA" ? e.value : e.textContent,options:Array.from(document.querySelectorAll("[role=option]")).map(o=>({id:o.id,selected:o.getAttribute("aria-selected"),text:o.textContent}))}))'
}
home() { agent-browser open "$ORIGIN/home"; agent-browser wait '[contenteditable=true]'; }
repo() { agent-browser open "$ORIGIN/spaces/$SPACE/agents"; agent-browser wait '[contenteditable=true]'; }
edit() { agent-browser click "$1"; agent-browser press Meta+a; agent-browser press Backspace; agent-browser fill "$1" "$2"; }
send() { edit '[contenteditable=true]' "$1"; agent-browser press Enter; agent-browser wait 'textarea'; agent-browser wait --fn 'document.querySelector("textarea") && !document.querySelector("button[aria-label=Stop]")'; }
follow() { agent-browser fill textarea "$1"; agent-browser press Enter; agent-browser wait --fn 'document.querySelector("textarea").value === "" && !document.querySelector("button[aria-label=Stop]")'; }
```

Sign in through the browser. Wait for the actual label after the first Vite load.

```bash
agent-browser open "$ORIGIN/login"
agent-browser storage local set univer-workspace-language en-US
agent-browser reload
agent-browser wait --text Username
agent-browser find label Username fill "$O"
agent-browser find label Password fill "$(cat "$RUN/user.pw")"
agent-browser click 'form button[type=submit]'
agent-browser wait --url '**/home'
agent-browser find role button click --name Agents --exact
```

**AS1. Save the mock provider.** The helper chooses a free port starting at 5986 with
`lsof` before starting the provider. Use that same port in the form.

```bash
mock as1 '[{"text":"AS1 ready."}]'
echo "Base URL http://127.0.0.1:$MODEL_PORT"
agent-browser find role button click --name 'Model settings' --exact
agent-browser find role button click --name 'Add an OpenAI-compatible provider'
agent-browser find label 'Provider name' fill 'AS mock'
agent-browser find label 'Base URL' fill "http://127.0.0.1:$MODEL_PORT"
agent-browser find label 'Models (comma separated)' fill mock-agent
agent-browser find label 'Default model' fill mock-agent
agent-browser snapshot -i -c
```

From this fresh snapshot, fill the new provider's **API key** with `mock-key` and click
its **Save** button by their refs. DeepSeek has a separate key and Save button.

```bash
agent-browser fill @NEW_PROVIDER_KEY mock-key
agent-browser click @NEW_PROVIDER_SAVE
agent-browser wait --text 'Settings saved'
shot as1
agent-browser find role button click --name Close --exact
agent-browser snapshot -i -c
```

Pass when the saved-state notice appears, the screenshot records it, and the composer
has **Model** set to **AS mock · mock-agent**. If another provider was selected, select
this one from **Model** before continuing. No real provider key is needed.

**AS2. First repository message.**

```bash
seed "$O/personal" as2-personal 'AS2 personal instructions.' > "$EVIDENCE/as2-seed-personal.json"
seed "$REPO" as2-repository 'AS2 repository instructions.' > "$EVIDENCE/as2-seed-repository.json"
mock as2 '[{"text":"AS2 complete."}]'
repo
send 'AS2 catalog please.'
agent-browser wait --text 'AS2 complete.'
shot as2
node "$A" requests "$EVIDENCE/as2-requests.jsonl" | tee "$EVIDENCE/as2-requests.txt"
```

Pass when the rail lists `as2-repository` as **Repository** and `as2-personal` as
**Personal**, and request 1's `lastUser` contains both catalog entries in a
`<system-reminder>` with `This list replaces any earlier one.`

**AS3. Expand the rail.**

```bash
seed "$REPO" as3-alpha 'AS3 alpha instructions.' > "$EVIDENCE/as3-seed-alpha.json"
seed "$O/personal" as3-beta 'AS3 beta instructions.' > "$EVIDENCE/as3-seed-beta.json"
mock as3 '[{"text":"AS3 complete."}]'
repo
send 'AS3 catalog please.'
agent-browser wait --text 'AS3 complete.'
shot as3-collapsed
agent-browser find role button click --name 'Show 1 more skills'
shot as3-expanded
agent-browser find role button click --name 'Show fewer skills'
shot as3-collapsed-again
```

Pass when exactly three skills appear initially, all four appear after expansion,
and three remain after collapse. The button's `aria-expanded` follows the state.

**AS4. Model reads a skill.**

```bash
seed "$REPO" as4-read 'AS4_READ_BODY: read me on demand.' > "$EVIDENCE/as4-seed.json"
mock as4 "[{\"tool\":{\"name\":\"skills_read\",\"arguments\":{\"name\":\"as4-read\",\"repo\":\"$SPACE\"}}},{\"text\":\"AS4 complete.\"},{\"text\":\"AS5 complete.\"},{\"text\":\"AS6 complete.\"}]"
repo
send 'AS4 read the skill.'
agent-browser wait --text 'AS4 complete.'
shot as4
node "$A" requests "$EVIDENCE/as4-requests.jsonl" | tee "$EVIDENCE/as4-requests.txt"
```

Pass when the steps show the successful `skills_read`, request 2 carries its result
with `AS4_READ_BODY`, and `as4-read` is first in the rail with **Used**.

**AS5. Unchanged second turn.** Continue AS4 without restarting the mock.

```bash
follow 'AS5 unchanged catalog.'
agent-browser wait --text 'AS5 complete.'
shot as5
node "$A" requests "$EVIDENCE/as4-requests.jsonl" | tee "$EVIDENCE/as5-requests.txt"
node "$A" prefix "$EVIDENCE/as4-requests.jsonl" 2 3 | tee "$EVIDENCE/as5-prefix.txt"
```

Pass when request 3's last user content is exactly `AS5 unchanged catalog.` and the
prefix check exits 0. The rail's synthetic cache-hit ratio remains 50%.

**AS6. Added skill between turns.** Continue AS5.

```bash
seed "$O/personal" as6-added 'AS6 added between turns.' > "$EVIDENCE/as6-seed.json"
follow 'AS6 refresh catalog.'
agent-browser wait --text 'AS6 complete.'
shot as6
node "$A" requests "$EVIDENCE/as4-requests.jsonl" | tee "$EVIDENCE/as6-requests.txt"
node "$A" prefix "$EVIDENCE/as4-requests.jsonl" 3 4 | tee "$EVIDENCE/as6-prefix.txt"
agent-browser find role button click --name 'Show 3 more skills'
shot as6-expanded
```

Pass when request 4's reminder contains the full six-entry replacement catalog,
including `as6-added`, the expanded rail shows it, and the prefix check exits 0.

**AS7. Global then repository scope.**

```bash
seed "$REPO" as7-scope 'AS7 repository scope instructions.' > "$EVIDENCE/as7-seed.json"
mock as7 '[{"text":"AS7 global complete."},{"text":"AS7 repository complete."}]'
home
send 'AS7 start globally.'
agent-browser wait --text 'AS7 global complete.'
shot as7-global
agent-browser find role combobox click --name Repository --exact
agent-browser wait '[role=option]'
agent-browser find role option click --name 'Repository: as-skills' --exact
follow 'AS7 now use the repository.'
agent-browser wait --text 'AS7 repository complete.'
shot as7-repository
node "$A" requests "$EVIDENCE/as7-requests.jsonl" | tee "$EVIDENCE/as7-requests.txt"
node "$A" prefix "$EVIDENCE/as7-requests.jsonl" 1 2 | tee "$EVIDENCE/as7-prefix.txt"
node "$A" system "$EVIDENCE/as7-requests.jsonl:1" "$EVIDENCE/as7-requests.jsonl:2" | tee "$EVIDENCE/as7-system.txt"
```

Pass when request 1's reminder lists only `(user)` skills, request 2 adds repository skills
including `as7-scope`, the system comparison prints `System messages match.`, and
prefix exits 0. **Repository: Auto** on Home starts with global scope.

**AS8. Non-member public repository.** Make this disposable repository public. Register
another throwaway user through the public API, then use a separate browser session.
Keep its generated password under `home`, which `down` removes.

```bash
seed "$REPO" as8-public 'AS8 public repository instructions.' > "$EVIDENCE/as8-seed.json"
$V cli as8-public-repo repo edit "$REPO" --visibility public --json
node --input-type=module - "$ORIGIN" "$EVIDENCE" "$RUN" <<'JS'
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
const [origin, evidence, run] = process.argv.slice(2);
const password = randomBytes(24).toString('hex');
const username = 'verify-' + process.env.VERIFY_UVW_RUN + '-outsider';
const response = await fetch(origin + '/api/auth/password/register', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username, displayName: 'AS8 outsider', password }),
});
assert.equal(response.status, 201);
writeFileSync(run + '/home/as8.pw', password, { mode: 0o600 });
writeFileSync(evidence + '/as8-user.json', JSON.stringify({ username, status: response.status }));
console.log('AS8 outsider registered, HTTP 201');
JS
mock as8 '[{"text":"AS8 complete."}]'
MAIN_BROWSER=$AGENT_BROWSER_SESSION
export AGENT_BROWSER_SESSION="verify-uvw-$VERIFY_UVW_RUN-as8"
agent-browser open "$ORIGIN/login"
agent-browser storage local set univer-workspace-language en-US
agent-browser reload
agent-browser wait --text Username
agent-browser find label Username fill "$O-outsider"
agent-browser find label Password fill "$(cat "$RUN/home/as8.pw")"
agent-browser click 'form button[type=submit]'
agent-browser wait --url '**/home'
agent-browser find role link click --name 'View all repositories' --exact
agent-browser wait 1500
agent-browser find role link click --name Explore --exact
agent-browser wait 1500
agent-browser find role link click --name "$O / as-skills" --exact
agent-browser wait 1500
agent-browser click "a[href=\"/spaces/$SPACE/agents\"]"
agent-browser wait '[contenteditable=true]'
```

Repeat AS1's provider form steps for this user's **AS mock** with the same Base URL
and `mock-key`. Use fresh snapshot refs, wait for **Settings saved**, then close the dialog.
Do not restart the mock or overwrite AS1's evidence.

```bash
send 'AS8 non-member catalog.'
agent-browser wait --text 'AS8 complete.'
shot as8
node "$A" requests "$EVIDENCE/as8-requests.jsonl" | tee "$EVIDENCE/as8-requests.txt"
agent-browser close
export AGENT_BROWSER_SESSION=$MAIN_BROWSER
```

Pass when the rail says **Repository skills not loaded: you are not a member.** and
request 1 has no `as8-public` reminder entry. This fresh outsider has no personal skills,
so its last user message is exactly `AS8 non-member catalog.`

**AS9. Diagnostics and repository precedence.**

```bash
seed "$O/personal" as9-shadow 'AS9_USER_BODY.' > "$EVIDENCE/as9-seed-user.json"
seed "$REPO" as9-shadow 'AS9_REPOSITORY_BODY.' > "$EVIDENCE/as9-seed-repository.json"
seed "$O/personal" sheet 'AS9 reserved-name instructions.' > "$EVIDENCE/as9-seed-reserved.json"
mkdir -p "$EVIDENCE/sources/as9-invalid"
printf -- '---\nname: another-name\ndescription: Invalid directory-name mismatch.\n---\nAS9_INVALID_BODY\n' > "$EVIDENCE/sources/as9-invalid/SKILL.md"
node "$B/seed-skills.mjs" "$REPO" as9-invalid "$EVIDENCE/sources/as9-invalid" > "$EVIDENCE/as9-seed-invalid.json"
mock as9 '[{"text":"AS9 complete."}]'
repo
send 'AS9 diagnostics please.'
agent-browser wait --text 'AS9 complete.'
agent-browser snapshot -i -c
```

Expand the rail. The count includes earlier journeys' valid skills. Save the expanded rail and requests.

```bash
agent-browser click 'aside.agent-session-rail button.agent-steps-window'
agent-browser wait --text Overridden
shot as9
node "$A" requests "$EVIDENCE/as9-requests.jsonl" | tee "$EVIDENCE/as9-requests.txt"
$V mcp as9-catalog skills_read "{\"repo\":\"$REPO\"}"
jq -e '([.diagnostics[].problem] | sort) == ["invalid-skill","reserved-name","shadowed"] and ([.skills[] | select(.name == "as9-shadow") | .source] == ["repository"])' "$EVIDENCE/as9-catalog.out"
```

Pass when the expanded rail lists **Overridden**, **Built-in name reserved**, and **Invalid skill**,
each with its `.agents/skills/.../SKILL.md` path. The reminder has exactly one
`as9-shadow (repository)` entry, no user shadow, no `sheet`, and no `as9-invalid`.

**AS10. Slash menu in both composers.** Seed two matching personal skills. Reloading
with `home` gives the composer a fresh scope catalog, including the new files.

```bash
seed "$O/personal" as10-alpha 'AS10 alpha instructions.' > "$EVIDENCE/as10-seed-alpha.json"
seed "$O/personal" as10-beta 'AS10 beta instructions.' > "$EVIDENCE/as10-seed-beta.json"
mock as10 '[{"text":"AS10 follow-up ready."}]'
home
edit '[contenteditable=true]' /as10
agent-browser wait '[role=listbox]'
aria > "$EVIDENCE/as10-home-before.json"
shot as10-home-menu
agent-browser press ArrowDown
aria > "$EVIDENCE/as10-home-after.json"
agent-browser press Tab
aria > "$EVIDENCE/as10-home-tab.json"
edit '[contenteditable=true]' /as10
agent-browser wait '[role=listbox]'
agent-browser press Escape
aria > "$EVIDENCE/as10-home-escape.json"
shot as10-home
send 'AS10 open the follow-up composer.'
agent-browser wait --text 'AS10 follow-up ready.'
agent-browser fill textarea /as10
agent-browser wait '[role=listbox]'
aria > "$EVIDENCE/as10-followup-before.json"
shot as10-followup-menu
agent-browser press ArrowDown
aria > "$EVIDENCE/as10-followup-after.json"
agent-browser press Tab
aria > "$EVIDENCE/as10-followup-tab.json"
agent-browser fill textarea /as10
agent-browser wait '[role=listbox]'
agent-browser press Escape
aria > "$EVIDENCE/as10-followup-escape.json"
shot as10-followup
```

Pass when both menus filter to `/as10-alpha` and `/as10-beta`, with source,
description, and `[topic]`. Each editor has `role=combobox`, `aria-expanded=true`,
and an `aria-activedescendant` matching a selected option. ArrowDown changes that ID.
Tab completes `/as10-beta ` and closes the menu. Escape closes it, clears the active
ID, and leaves `/as10` intact. No menu action sends a message.

**AS11. Explicit arguments and the message pill.**

```bash
seed "$O/personal" as11-args 'AS11_ARGS_BODY: report for $ARGUMENTS.' > "$EVIDENCE/as11-seed-args.json"
seed "$O/personal" as11-append 'AS11_APPEND_BODY: summarize the topic.' > "$EVIDENCE/as11-seed-append.json"
mock as11 '[{"text":"AS11 substituted."},{"text":"AS11 appended."}]'
home
send '/as11-args 2026-W46'
agent-browser wait --text 'AS11 substituted.'
shot as11-args
follow '/as11-append revenue'
agent-browser wait --text 'AS11 appended.'
shot as11-append
node "$A" requests "$EVIDENCE/as11-requests.jsonl" | tee "$EVIDENCE/as11-requests.txt"
```

Pass when the bubbles render `/as11-args` and `/as11-append` as pills. Request 1's
invocation reminder has `AS11_ARGS_BODY: report for 2026-W46.` with no `$ARGUMENTS`.
Request 2 has `AS11_APPEND_BODY` followed by `ARGUMENTS: revenue`. Both have empty
`toolResults`; the scripted model never calls `skills_read` for these invocations.

**AS12. Repeat invocation in the follow-up composer.**

```bash
seed "$O/personal" as12-repeat 'AS12_REPEAT_BODY: work on $ARGUMENTS.' > "$EVIDENCE/as12-seed.json"
mock as12 '[{"text":"AS12 first complete."},{"text":"AS12 repeat complete."}]'
home
send '/as12-repeat first-topic'
agent-browser wait --text 'AS12 first complete.'
follow '/as12-repeat second-topic'
agent-browser wait --text 'AS12 repeat complete.'
shot as12
node "$A" requests "$EVIDENCE/as12-requests.jsonl" | tee "$EVIDENCE/as12-requests.txt"
node "$A" prefix "$EVIDENCE/as12-requests.jsonl" 1 2 | tee "$EVIDENCE/as12-prefix.txt"
```

Pass when request 2's last user reminder says the instructions are already loaded,
includes `ARGUMENTS: second-topic`, omits `AS12_REPEAT_BODY`, and prefix exits 0.
The repeated invocation still has a pill and marks the skill used.

**AS13. Manual-only skill and resource exception.**

```bash
mkdir -p "$EVIDENCE/sources/as13-manual/references"
printf 'AS13_SUPPORTING_GUIDE: resources remain readable.\n' > "$EVIDENCE/sources/as13-manual/references/guide.md"
seed "$O/personal" as13-manual 'AS13_MANUAL_BODY: work on $ARGUMENTS.' 'disable-model-invocation: true\n' > "$EVIDENCE/as13-seed.json"
mock as13 '[{"tool":{"name":"skills_read","arguments":{"name":"as13-manual"}}},{"tool":{"name":"skills_read","arguments":{"name":"as13-manual","resource":"references/guide.md"}}},{"text":"AS13 complete."}]'
home
send '/as13-manual user-topic'
agent-browser wait --text 'AS13 complete.'
shot as13
node "$A" requests "$EVIDENCE/as13-requests.jsonl" | tee "$EVIDENCE/as13-requests.txt"
```

Pass when `/as13-manual` works with a pill and its invocation reminder includes
`AS13_MANUAL_BODY: work on user-topic.`. The catalog reminder has no
`- as13-manual` entry. Request 2's tool result denies the model's read with
`The skill "as13-manual" can only be invoked by the user with /as13-manual.`.
Request 3's resource result contains `AS13_SUPPORTING_GUIDE`.

**AS14. Model-only skill.**

```bash
seed "$O/personal" as14-model 'AS14_MODEL_BODY: model-only instructions.' 'user-invocable: false\n' > "$EVIDENCE/as14-seed.json"
seed "$O/personal" as14-visible 'AS14 visible instructions.' > "$EVIDENCE/as14-seed-visible.json"
mock as14 '[{"tool":{"name":"skills_read","arguments":{"name":"as14-model"}}},{"text":"AS14 complete."}]'
home
edit '[contenteditable=true]' /as14
agent-browser wait '[role=listbox]'
aria > "$EVIDENCE/as14-menu.json"
jq -e '.[0].options | map(.text) | any(contains("/as14-visible")) and (any(contains("/as14-model")) | not)' "$EVIDENCE/as14-menu.json"
shot as14-menu
send '/as14-model'
agent-browser wait --text 'AS14 complete.'
shot as14
node "$A" requests "$EVIDENCE/as14-requests.jsonl" | tee "$EVIDENCE/as14-requests.txt"
```

Pass when the `/as14` menu lists `/as14-visible` but not `/as14-model`, the bubble stays plain text, and
request 1 has a catalog entry but no explicit invocation reminder for it. Request 2's
model tool result contains `AS14_MODEL_BODY`.

**AS15. Running session treats slash text as steering.**

```bash
seed "$O/personal" as15-steer 'AS15_STEER_BODY: do not expand steering.' > "$EVIDENCE/as15-seed.json"
mock as15 '[{"delayMs":15000,"tool":{"name":"skills_read","arguments":{"name":"as15-steer"}}},{"text":"AS15 tool step complete."},{"text":"AS15 complete."}]'
home
edit '[contenteditable=true]' 'AS15 start a slow step.'
agent-browser press Enter
agent-browser wait 'textarea'
agent-browser wait 'button[aria-label=Stop]'
agent-browser fill textarea /as15-steer
aria > "$EVIDENCE/as15-running.json"
shot as15-running
agent-browser press Enter
agent-browser wait --text 'AS15 complete.'
shot as15-complete
node "$A" requests "$EVIDENCE/as15-requests.jsonl" | tee "$EVIDENCE/as15-requests.txt"
```

Pass when the running textarea has `aria-expanded=false`, no listbox appears, and the
queued message arrives in a later request as plain `/as15-steer` without an invocation or
catalog reminder. The tool-result request can arrive before steering is appended. The bubble stays plain text. The initial model skill read can still
succeed. Text queued while a step runs joins that run without a catalog refresh or slash
expansion. Text queued after a run ends starts a new run, which refreshes the catalog and
expands `/name`.

Finish by stopping only this shell's mock and this run.

```bash
kill "$MODEL_PID"
wait "$MODEL_PID" || true
$V down
```

## Gotchas

- Wait for **Settings saved** before closing Model settings. Use fresh snapshot refs
  for the new provider's key and Save button. Broad selectors can hit the DeepSeek
  form or fail while the provider form changes state.
- The Lexical composer reports typing through `beforeinput`, not `input`. Use `edit`
  to select all and delete through keyboard commands before filling. `agent-browser fill`
  can append when the Lexical editor already contains text. Setting `textContent` and
  dispatching `input` does not update its state. The follow-up composer is a textarea.
- The menu caches catalogs for its scope while the page lives. Reload the page after
  seeding a skill when testing menu discovery. Each run fetches a fresh catalog.
- If a skill is deleted after menu selection but before sending, the fresh run catalog
  no longer matches it. The message is sent as plain text. If it disappears after
  catalog loading but during its by-name read, the run reports a read error.
- Approval flows are unreachable in this browser journey because publish tools are not
  in the browser Agent's core toolset. Do not script a publish tool as an approval test.
- Compare system messages across instances only after replacing each instance's Space
  IDs. For example, `node "$A" system trunk.jsonl:1 head.jsonl:1 --replace "$TRUNK_SPACE=SPACE" --replace "$HEAD_SPACE=SPACE"`.
  `prefix` compares within a session and does not normalize anything.
- A browser renderer can go blank and drop session storage. Re-sign-in and re-add the
  provider before continuing, then start that journey with a new mock log label.
- Mock cache counts are synthetic. A 50% UI ratio proves usage display, while
  `agent-requests prefix` proves the actual message, system, and tool invariants.
- Requests include full prompts and tool output. Keep the JSONL logs in local evidence.
  Never add real provider credentials to a mock script or evidence.

## Skill draft review and publication

- AS16 reviews a valid HTTP draft with Markdown, an expandable reference, a verified quote and an omitted fake quote.
- AS17 blocks publication for invalid frontmatter and explains why.
- AS18 compares a replacement against current files and lists files moved to Trash.
- AS19 publishes through the browser, discovers the Skill in the slash menu and verifies its invocation body in the mock request.
- AS20 rejects through the browser and reads back the rejected state.

Run with MCP and the same-origin proxy enabled, as for AS1. Choose free ports with
`lsof` and keep one persistent shell for the instance and mock provider. Use the
Vite web URL. The built SPA fallback cannot serve nested routes from checkouts
under dotted directories on this Mac.

After `up`, `user`, `doctor` and browser sign-in, create the fixtures through the
public HTTP API. The helper signs in with the disposable user's interactive
Session, checks the evidence and stores draft envelopes under `$EVIDENCE`.

```bash
eval "$($V env)"
node "$B/skill-drafts.mjs" create | tee "$EVIDENCE/sb2-create.txt"
```

**AS16. Review evidence.** Open `draft.previewPath` from `sb2-draft.json` at
`$ORIGIN`. Wait for **Partially available**, rendered **Browser draft** and
**1 unverified**. Expand `references/guide.md` and capture `sb2-review.png`.
The verified finding links to `SKILL.md:9`, quotes the real instruction and gives
its impact and suggestion. Click that link. Source lines expand and line 9 gains
focus. Save `sb2-finding-line.png`. The Skill description appears under the page title. Preview starts at the Markdown
body, without YAML frontmatter. Click **Source** and verify it retains the original
frontmatter; the source line numbers and replacement diff also use the raw text.
The English headline uses **1 issue found** for one finding.
The fake quote is absent, the destination is
`.agents/skills/sb2-review/`, and **Publish** is enabled.

**AS17. Invalid frontmatter.** Open the path in `sb2-invalid.json`. Capture
`sb2-invalid.png`. **Blocking** lists `frontmatter-invalid`, **Publish** is disabled,
and **Resolve the blocking findings before publishing.** explains the disabled
control. No files have been published.

**AS19. Publish and invoke.** Return to the AS16 draft and click **Publish**.
Wait for **Published**, reload and capture `sb2-published.png`. Click **Agents**
on Home, configure the AS1 mock provider with one text step, then reload Home.
Type `/sb2` into the composer and capture `sb2-slash-menu.png`. The menu lists
`/sb2-review` as personal. Send `/sb2-review some args`, wait for the mock reply
and capture `sb2-invoked.png`.

```bash
node "$A" requests "$EVIDENCE/sb2-requests.jsonl" | tee "$EVIDENCE/sb2-requests.txt"
```

The request's last user reminder contains `SB2_SKILL_BODY: summarize some args.`.
The invocation has no model `skills_read` tool call. Synthetic mock token counts
only verify usage display.

**AS18. Replacement.** After AS19 publishes the Skill, create a replacement.

```bash
node "$B/skill-drafts.mjs" replace | tee "$EVIDENCE/sb2-replace.txt"
```

Open the path from `sb2-replace.json` and capture `sb2-replace.png`. The `SKILL.md`
Changes section shows `- SB2_SKILL_BODY` and `+ SB2_REVISED_BODY`.
**Files moved to Trash on publish** lists `references/guide.md`. The helper checks
that the complete replacement base contains two files. Leave this draft pending.

**AS20. Reject.** Open the path in `sb2-reject.json`, click **Reject**, wait for
**Rejected**, reload and capture `sb2-rejected.png`. Read both decisions back
through HTTP, then stop the mock and run `down`.

```bash
node "$B/skill-drafts.mjs" check | tee "$EVIDENCE/sb2-readback.txt"
kill "$MODEL_PID"
wait "$MODEL_PID" || true
$V down
```

The helper asserts the AS19 draft is `published` and AS20 draft is `rejected`.
Keep JSON readbacks, screenshots, mock JSONL and summary text with the run evidence.
