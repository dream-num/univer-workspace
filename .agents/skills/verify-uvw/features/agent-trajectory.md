# Browser Agent trajectory

Debug mode adds a Trajectory tab to browser Agent sessions. It shows the recorded provider requests, model responses, tool results, cache usage, and timing from this browser's IndexedDB. Conversation remains available while the agent runs.

## Sub-features

- TR2-1 covers the unchanged conversation with Debug mode off.
- TR2-2 covers the settings switch, persistence, and cross-tab changes.
- TR2-3 covers SYSTEM, Turn and step rows, tool parentage, and timing.
- TR2-4 covers user text and reminder sources without changing message boundaries.
- TR2-5 covers tool arguments, sent results, MCP results, schema, and folded JSON.
- TR2-6 covers Context sent, NEW markers, cache counts, and copying exact requests.
- TR2-7 covers errors, retries, attempts, and error filtering.
- TR2-8 covers running calls and returning to Conversation to steer.
- TR2-9 covers searching sent content and MCP results with ancestor rows retained.
- TR2-10 covers sessions without records and rewritten history.

## How to get to it (user POV)

Open Application settings from the account menu. Below Theme, set Debug mode to On. Open an Agent session and select Trajectory. Select a row to open its details. Select Conversation to return to chat and its composer. Turning Debug mode off removes the tabs. The preference persists in this browser and follows changes from other tabs.

## Driving it with agent-browser and uvw

Use the isolated run and browser session described in [the verification index](./README.md). Use the mock provider instructions in [SKILL.md](../SKILL.md#browser-agent-mock-model) to add an OpenAI-compatible model and capture its request log. Use a unique run and allowed ports. Do not attach to another run's server.

After a session runs, dump the recorded requests from its Vite dev session page:

```bash
agent-browser eval "$(cat .agents/skills/verify-uvw/bin/trajectory-dump.js)"
```

Each item contains the sequence, outcome, attempts, common-prefix length, rewrite flag, and expanded request body. Compare the body string with the corresponding mock log entry without parsing and serializing it again.

1. **TR2-1.** Run the same two-turn script on trunk and head. The first turn calls `repo_list` then returns text; the second returns text. Leave Debug mode off on head. Capture `tr2-regression.png`. Confirm identical conversation content and layout, no tabs, and a new settings row defaulting off.
2. **TR2-2.** Enable Debug mode in settings, reload, and open the same session in a second browser tab. Disable it in the first tab. Capture `tr2-toggle.png`. Confirm both tabs disappear in the second tab without reload.
3. **TR2-3.** Enable Debug mode after the two-turn script and select Trajectory. Capture `tr2-tree.png`. Confirm SYSTEM then two Turns, numbering starts at 1 in each Turn, tools are indented under their assistant, and model duration and token counts match the dump.
4. **TR2-4.** In repository scope attach a reference and send a message. Select USER, then As sent. Capture `tr2-user.png`. Compare every content part with the mock log. References and Skill catalog must be labeled within the original user content.
5. **TR2-5.** Seed a Sheet with at least 40 rows using [seed-sheets.mjs](../bin/seed-sheets.mjs), and have the mock call `outline` on it. Select TOOL. Capture `tr2-tool.png`. Compare Arguments with the request's tool-call arguments. As sent must show the tool message, including JSON strings as trees. Nodes above 4 KB must start folded and expand fully. MCP result must show structuredContent and the notice that it is not what the model received. Check Timing and Schema.
6. **TR2-6.** Select the second model call and Context sent. Capture `tr2-context.png`. Only added messages are NEW. Compare input, hit and miss counts with usage. Click Copy request JSON, read the clipboard with `agent-browser eval 'navigator.clipboard.readText()'`, and compare it byte for byte with the second mock request body.
7. **TR2-7.** Run a script with a 500 `overloaded` response followed by success, then another with enough 500 responses to exhaust retries. Send a new successful message afterward. Capture `tr2-errors.png`. Inspect Usage & timing for every attempt's HTTP status and error body. A failed call has no tool child rows. Only errors retains the failing rows and their Turn.
8. **TR2-8.** Run a script step with `delayMs: 8000`. Stay on Trajectory and capture `tr2-live.png`. Confirm a growing bar, followed by final timing and tokens without reload. Switch to Conversation while running and append a steering message. Its first appearance in a request opens a new Turn.
9. **TR2-9.** Search for a repository name in the recorded `repo_list` result. Capture `tr2-search.png`. Matching tool rows retain their assistant and Turn. Search an absent term and confirm the empty state. Clear search and confirm the full tree returns.
10. **TR2-10.** Following the IndexedDB preparation conventions, create a session with messages but no trajectory records. Create a separate session with three records, where the third request changes an earlier message so its common prefix is shorter. Capture `tr2-unrecorded.png` and `tr2-rewrite.png`. Confirm the old-session notice and usable Conversation tab. Confirm one history rewrite and REWRITTEN markers beginning at the changed position in the third call's Context sent.

For the performance lane, prepare a 40-call recorded session. Use a MutationObserver and performance.now() to measure from selecting Trajectory until every expected step row exists. Repeat ten times and compare the median with the 500 ms budget. Separately compare first-message visibility with Debug mode off on trunk and head, ten alternating runs each, against the +50 ms budget. Keep timing logs with screenshots. A component fixture alone does not establish the full-page performance budget.

## Gotchas

- Debug mode controls display. Recording is always enabled. Old sessions cannot be reconstructed.
- Dumping requires a Vite dev page. It dynamically imports the store and expansion modules.
- All sent content comes from expanded recorded requests. Session UI parts supply only tool timing, error state, and MCP structuredContent.
- A final tool result may be unsent because no later model call consumed it. MCP result is not a substitute for As sent.
- An unparsed request exposes only its original body. Invalid stored records are skipped and counted.
- Copy request JSON copies the expanded body string unchanged. Copy inside a JSON tree copies that value's displayed raw representation.
- Tabs and selection are local component state. They do not change the URL.
