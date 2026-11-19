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
  const actionPin = action => {
    const prefix = "uses: dream-num/release-actions/" + action + "@";
    const uses = workflow.split("\n").map(line => line.trim()).filter(line => line.startsWith(prefix));
    assert.equal(uses.length, 1);
    const pin = uses[0].slice(prefix.length);
    assert.match(pin, /^[0-9a-f]{40}$/u);
    return pin;
  };
  assert.equal(actionPin("assemble-npm-batch"), actionPin("promote-npm"));
  const ci = await readFile(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8");
  assert.match(ci, /if: matrix.stage == 'test-cli'\s+run: node --test scripts\/release\/\*.test\.mjs/u);
  assert.doesNotMatch(ci, /id-token: write|secrets\.NPM_TOKEN/u);
});
