#!/usr/bin/env bash
# One task inside a verify runner container, in the two phases runner.mjs runs through docker exec. prepare starts
# the instance in the journeys' mode, then writes the brief; run runs the helper's journeys and the verifier's session
# unless --no-model, then per run secret-check, down, copy.
# Usage: task.sh prepare|run [--no-model] <task-id> <feature> [journey-id|mode...]
phase=$1 model=1
shift
[[ "${1:-}" != --no-model ]] || { model=; shift; }
task=$1 feature=$2
shift 2
out=/batch/$task
cd ~/repo || exit 1
V=.agents/skills/verify-uvw/bin/verify-uvw
# up links each run's evidence/ and logs/ to $out/runs/<run>/ on the host, including runs a recipe starts under its own root.
export VERIFY_UVW_EVIDENCE_ROOT=$out/runs

if [[ "$phase" == prepare ]]; then
  mkdir -p "$out/runs"
  rm -rf /tmp/verify-uvw /tmp/verify-uvw-*
  # A failed prepare skips the verifier; runner.mjs reports the task as infra-error with the FAIL lines of prepare.log.
  # The first page load starts Chromium and makes Vite compile the app. Under host load that outran agent-browser's
  # fixed 25 s load timeout and broke the first browser check of a journey, so prepare loads it, retrying: Vite keeps
  # compiling after a timed-out load, and open is safe to repeat.
  VERIFY_UVW_RUN=$task timeout 900 bash -c '"$0" up --for "$@" && "$0" user && "$0" doctor && eval "$("$0" env)" || exit 1
    for try in 1 2 3 4 5; do agent-browser open "$ORIGIN/login" && exit 0; sleep 5; done
    echo "FAIL  the browser did not load $ORIGIN/login in 5 tries"; exit 1' \
    "$V" "$feature" "$@" >"$out/prepare.log" 2>&1 || echo $? >"$out/prepare.failed"
  # The host brief checks that the run is up in the journeys' mode, so it comes after a prepare that worked, followed by
  # the addendum runner.mjs wrote for this task.
  [[ -f "$out/prepare.failed" ]] || { VERIFY_UVW_RUN=$task $V brief "$feature" "$@" && cat "$out/addendum.txt"; } >"$out/brief.txt" 2>>"$out/prepare.log" \
    || echo 3 >"$out/prepare.failed"
  exit 0
fi
[[ "$phase" == run ]] || { echo "usage: task.sh prepare|run [--no-model] <task-id> <feature> [journey-id|mode...]" >&2; exit 2; }

if [[ ! -f "$out/prepare.failed" ]]; then
  # Before the verifier, so no helper journey meets the timeout of its Bash tool; with no model this is the whole task.
  VERIFY_UVW_RUN=$task $V run-journeys "$feature" "$@" >"$out/run-journeys.log" 2>&1
  if [[ -n "$model" ]]; then
    # claude -p exits only after its background tasks end, so a server the verifier started as one held a finished task
    # until the timeout. Without them it starts such servers with &, which outlive the session.
    CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1 timeout 1800 claude -p "$(cat "$out/brief.txt")" --output-format stream-json --verbose --max-turns 150 \
      --dangerously-skip-permissions >"$out/transcript.jsonl" 2>"$out/claude.stderr"
    echo $? >"$out/claude.exit"
  fi
fi
# secret-check goes before down, which deletes the run's secret values; skip each root's current symlink so no run is downed early.
for r in /tmp/verify-uvw*/*/run.env; do
  d=${r%/run.env}
  [[ -e "$r" && ! -L "$d" ]] || continue
  id=${d##*/} root=${d%/*}
  { VERIFY_UVW_ROOT=$root VERIFY_UVW_RUN=$id $V secret-check; VERIFY_UVW_ROOT=$root VERIFY_UVW_RUN=$id $V secret-check "$out"; } >"$out/secret-check-$id.txt" 2>&1
  VERIFY_UVW_ROOT=$root VERIFY_UVW_RUN=$id $V down >/dev/null 2>&1
  # evidence/ and logs/ are already there; copy the files that survive down, such as run.env.
  mkdir -p "$out/runs/$id" && find "$d" -maxdepth 1 -type f -exec cp {} "$out/runs/$id/" \;
done
# down closes only its run's browser session; the agent may have opened others, such as an anonymous visitor's.
agent-browser close --all >/dev/null 2>&1
