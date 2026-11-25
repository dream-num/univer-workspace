# Hand journeys to your own verifier

`$V delegate` hands a brief to a verifier: another agent, on the model the developer chose, in a
background [herdr](https://herdr.dev) tab of its own. Its tokens go to that agent's account. You still choose the
journeys, start and stop the instance, and judge the evidence, as in
[Hand the driving to another agent](../SKILL.md#hand-the-driving-to-another-agent). `verifier` and `delegate` need
your own agent to run inside a herdr pane (`HERDR_ENV=1`).

## Set up

Set a verifier up with the developer when they ask to delegate and `$V verifier` prints `verifier: none`, and
when they ask to set one up, change it, or test it again, such as after they upgrade herdr or the agent.

1. Check `herdr --version` and `HERDR_ENV`. Without herdr, or outside a herdr pane, ask the developer to install it
   or to restart their agent in a pane, and stop.
2. Ask which agent and which model should drive journeys. Offer the agents installed here that herdr can start,
   such as `opencode`, `codex` or `claude`. Do not choose the model for them.
3. Write the spec `[NAME=VALUE...] <kind> [agent args...]`. `<kind>` is a herdr agent kind, and the words after it
   are that agent's arguments. Each leading `NAME=VALUE` goes into the verifier pane's environment only. Words split
   on whitespace, so no value can hold a space. The agent must start on the chosen model and run commands without
   asking for approval. opencode's TUI otherwise uses the model picked last in any opencode session. With
   `--standalone` it reads its configuration from the pane, and `opencode models <provider>` lists the models:

   ```text
   OPENCODE_CONFIG_CONTENT={"model":"<provider>/<model>#<variant>"} opencode --standalone
   ```

   codex reads `~/.codex` as usual, and the flag lets it run commands without approval, which a verifier needs:

   ```text
   codex --dangerously-bypass-approvals-and-sandbox -m <model> -c model_reasoning_effort=<effort>
   ```

4. Run `$V verifier '<spec>'`. It starts the verifier in a background tab named `verify setup`, asks it to write a
   file with one shell command, prints the bottom of its screen and closes the tab. It saves the spec only when the
   file was written and herdr saw the agent stop. The file is `~/.config/verify-uvw/verifier` (under
   `$XDG_CONFIG_HOME` when set), mode 0600, because a value may hold an API key. Before it saves, a `transcript:` line
   names the test's session in the agent's own record, which is where `delegate` reads the transcript. When it says
   `unavailable`, `delegate` saves the verifier's screen instead. That line never fails the test. Show the developer
   the screen so they confirm the model. The test cannot, because an agent may run on another model without an error,
   as opencode does when the named one does not exist. When the test fails, the screen says why, such as an approval
   prompt or a provider error, and any saved spec stays as it was.

From then on `$V doctor` and `$V verifier` print the verifier, with the names of its variables but never their
values, and delegating is the default. The developer can ask for a subagent for one task, set
`VERIFY_UVW_VERIFIER='<spec>'` to override the file in one shell, or run `$V verifier off` to delete the file.

## Delegate

Run `$V delegate <feature> [journey-id|mode...]` in step 3, after `up`, `user`, `doctor` and any `run-journeys`, with
the selection you would pass to `brief`. It opens a background tab named `verify <run> <feature>` and starts the
verifier there as agent `<run>-<feature>-<pane>`, so your tab's layout stays as it is and herdr's sidebar shows which
run each verifier drives. It sends the verifier `$V brief` unchanged and waits up to 60 minutes for it to stop, so run
it in the background when your harness can.

| The verifier | `delegate` |
| --- | --- |
| stops | saves its transcript to `evidence/<agent>.transcript.md`, closes the tab, prints `$V journeys` and exits with its code |
| waits for approval | keeps the tab open and exits 1 |
| still works after 60 minutes, or herdr fails | prints the visible screen, keeps the tab open and exits 1 |

The transcript is the verifier's session as its agent recorded it. It holds the verifier's messages and each command
it ran, with the command's exit code and the first 40 lines of its output, and run secrets are redacted. `delegate`
reads opencode and codex sessions. For another agent kind, or when it finds no session that began with the brief, it
prints a warning and saves the verifier's screen to `evidence/<agent>.screen.txt` instead.

When the tab stays open, answer in it or wait with `herdr agent wait <agent>`. Then run `$V journeys` and
`herdr pane close <pane>` yourself, which closes the tab with its only pane. The verdicts in the journal decide the
result, not the transcript. A verifier that stopped on a provider error leaves journeys `MISSING`, so `delegate` exits
1 with `INCOMPLETE`. Then do step 4 as usual, and open the evidence before you repeat a verdict.

A run drives one verifier at a time, because it has one browser and its features see each other's data. `delegate`
refuses while an earlier verifier of the run still lives. To verify in parallel, start more runs as in
[Parallel runs](../SKILL.md#parallel-runs), each with its own `delegate`. Each `delegate` starts a fresh verifier
session, and later features of the same mode reuse the instance without another `up`.
