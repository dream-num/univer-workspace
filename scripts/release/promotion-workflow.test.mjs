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
  const schema = workflow.split("    inputs:\n")[1].split("\npermissions:")[0];
  assert.deepEqual([...schema.matchAll(/^      ([^:\n]+):/gmu)].map(x=>x[1]), ["package", "latest", "version", "dry_run"]);
  assert.match(schema, /package:[\s\S]*type: choice\s+options:\s+- univer-workspace-cli/u);
  assert.match(schema, /latest:[\s\S]*type: boolean\s+default: true/u);
  assert.match(schema, /version:[\s\S]*type: string/u);
  assert.doesNotMatch(workflow, /reviewed_batch|promotion-input/u);
  assert.match(workflow, /dry_run:[\s\S]*default: true/u);
  assert.match(workflow, /mode: \$\{\{ inputs.dry_run && 'validate' \|\| 'submit' \}\}/u);
  assert.match(workflow, /id-token: write/u);
  assert.match(workflow, /toJSON\(inputs.package\), toJSON\(inputs.version\)/u);
  assert.match(workflow, /toJSON\(inputs.latest && 'latest' \|\| 'promoted'\)/u);
  assert.match(workflow, /batch: \$\{\{ steps.resolve.outputs.batch \}\}/u);
  assert.match(workflow, /id: resolve[\s\S]*uses: dream-num\/release-actions\/assemble-npm-batch@[0-9a-f]{40}/u);
  assert.match(workflow, /allowed_packages: univer-workspace-cli/u);
  assert.match(workflow, /npm@11\.21\.0/u);
  const actions = workflow.match(/uses: dream-num\/release-actions\/promote-npm@[0-9a-f]{40}$/gmu);
  assert.equal(actions?.length, 1);
  const ci = await readFile(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8");
  assert.match(ci, /if: matrix.stage == 'test-cli'\s+run: node --test scripts\/release\/\*.test\.mjs/u);
  assert.doesNotMatch(ci, /id-token: write|secrets\.NPM_TOKEN/u);
});
