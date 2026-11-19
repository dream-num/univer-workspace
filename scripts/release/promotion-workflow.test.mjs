import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("credentialed workflow stays manual/default-branch only with exact selection and pinned npm", async () => {
  const workflow = await readFile(
    new URL("../../.github/workflows/promote-cli-public.yml", import.meta.url),
    "utf8",
  );
  const gate = workflow.split("  promote:\n")[1].split("    runs-on:")[0];
  assert.match(gate, /github.event_name == 'workflow_dispatch'/u);
  assert.match(
    gate,
    /github.ref == format\('refs\/heads\/\{0\}', github.event.repository.default_branch\)/u,
  );
  assert.doesNotMatch(gate, /github.repository ==|\|\|/u);
  assert.doesNotMatch(workflow, /pull_request:|  test:|needs: test|inputs.publish/u);
  assert.match(workflow, /selection:[\s\S]*type: string/u);
  assert.match(workflow, /p\?\.name !== "univer-workspace-cli"/u);
  assert.match(workflow, /dry_run:[\s\S]*default: true/u);
  assert.match(workflow, /mode: \$\{\{ inputs.dry_run && 'validate' \|\| 'submit' \}\}/u);
  assert.match(workflow, /id-token: write/u);
  assert.match(workflow, /batch: \$\{\{ steps.plan.outputs.batch \}\}/u);
  assert.match(workflow, /npm@11\.21\.0/u);
  const tests = await readFile(
    new URL("../../.github/workflows/test-cli-promotion.yml", import.meta.url),
    "utf8",
  );
  for (const action of ["assemble-npm-batch", "promote-npm"]) {
    const uses = workflow.split("\n").find(line => line.includes("dream-num/release-actions/" + action + "@")).trim();
    assert.match(uses, /@[0-9a-f]{40}$/u);
    assert.ok(tests.includes(uses));
  }
  assert.match(tests, /npm@11\.21\.0/u);
  assert.doesNotMatch(tests, /secrets\.|id-token: write|--publish/u);
});
