#!/usr/bin/env bash
# One task inside a verify runner container: the brief, the verifier's session, then per run secret-check, down, copy.
# Usage: task.sh <task-id> <feature> [journey-id...]   (bin/runner.mjs runs it through docker exec)
task=$1 feature=$2
shift 2
out=/batch/$task
mkdir -p "$out/runs"
cd ~/repo || exit 1
V=.agents/skills/verify-uvw/bin/verify-uvw
rm -rf /tmp/verify-uvw
$V brief --own "$task" "$feature" "$@" >"$out/brief.txt" || exit 3
timeout 1800 claude -p "$(cat "$out/brief.txt")" --output-format stream-json --verbose --max-turns 150 \
  --dangerously-skip-permissions >"$out/transcript.jsonl" 2>"$out/claude.stderr"
echo $? >"$out/claude.exit"
# secret-check goes before down, which deletes the run's secret values; skip the current symlink so no run is downed early.
for r in /tmp/verify-uvw/*/run.env; do
  d=${r%/run.env}
  [[ -e "$r" && ! -L "$d" ]] || continue
  id=${d##*/}
  { VERIFY_UVW_RUN=$id $V secret-check; VERIFY_UVW_RUN=$id $V secret-check "$out"; } >"$out/secret-check-$id.txt" 2>&1
  VERIFY_UVW_RUN=$id $V down >/dev/null 2>&1
  cp -r "$d" "$out/runs/$id"
done
# down closes only its run's browser session; the agent may have opened others, such as an anonymous visitor's.
agent-browser close --all >/dev/null 2>&1
