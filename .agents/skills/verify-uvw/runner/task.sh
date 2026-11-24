#!/usr/bin/env bash
# One task inside a verify runner container: the brief, the verifier's session, then per run secret-check, down, copy.
# Usage: task.sh <task-id> <feature> [journey-id...]   (bin/runner.mjs runs it through docker exec)
task=$1 feature=$2
shift 2
out=/batch/$task
mkdir -p "$out/runs"
cd ~/repo || exit 1
V=.agents/skills/verify-uvw/bin/verify-uvw
rm -rf /tmp/verify-uvw /tmp/verify-uvw-*
# up links each run's evidence/ and logs/ to $out/runs/<run>/ on the host, including runs a recipe starts under its own root.
export VERIFY_UVW_EVIDENCE_ROOT=$out/runs
$V brief --own "$task" "$feature" "$@" >"$out/brief.txt" || exit 3
# claude -p exits only after its background tasks end, so a server the verifier started as one held a finished task
# until the timeout. Without them it starts such servers with &, which outlive the session.
CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1 timeout 1800 claude -p "$(cat "$out/brief.txt")" --output-format stream-json --verbose --max-turns 150 \
  --dangerously-skip-permissions >"$out/transcript.jsonl" 2>"$out/claude.stderr"
echo $? >"$out/claude.exit"
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
