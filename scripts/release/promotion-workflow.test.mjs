import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { normalizePromotionInput } from "./promotion-input.mjs";

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
  assert.match(workflow, /node scripts\/release\/promotion-input\.mjs/u);
  assert.match(workflow, /dry_run:[\s\S]*default: true/u);
  assert.match(workflow, /mode: \$\{\{ inputs.dry_run && 'validate' \|\| 'submit' \}\}/u);
  assert.match(workflow, /id-token: write/u);
  assert.match(workflow, /id: plan\s+if: inputs.dry_run\s+uses: dream-num\/release-actions\/assemble-npm-batch@/u);
  assert.match(workflow, /batch: \$\{\{ inputs.dry_run && steps.plan.outputs.batch \|\| steps.input.outputs.input \}\}/u);
  assert.match(workflow, /\.promotion\/batch\/batch\.json/u);
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


test("live dispatch cannot use a mutable selection or overwrite the accepted digest from an earlier validation run", () => {
  const p = { name: "univer-workspace-cli", version: "0.7.1", tag: "latest" };
  const selection = JSON.stringify({ batchId: "uvw-0.7.1", packages: [p] });
  const reviewedBatch = JSON.stringify({ schema: 1, sourceRegistry: "https://insider-npm-registry.univer.work/",
    batchId: "uvw-0.7.1", packages: [{ ...p, integrity: "sha512-" + Buffer.alloc(64, 1).toString("base64") }] });
  const changedSelection = JSON.stringify({ batchId: "uvw-0.7.1",
    packages: [{ ...p, integrity: "sha512-" + Buffer.alloc(64, 2).toString("base64") }] });
  assert.equal(normalizePromotionInput({ dryRun: "true", selection }), selection);
  assert.equal(normalizePromotionInput({ dryRun: "false", reviewedBatch }), reviewedBatch);
  assert.throws(() => normalizePromotionInput({ dryRun: "false", selection }), /reviewed_batch/u);
  assert.throws(() => normalizePromotionInput({ dryRun: "false", reviewedBatch, selection: changedSelection }), /reviewed_batch/u);
  assert.throws(() => normalizePromotionInput({ dryRun: "true", selection, reviewedBatch }), /selection only/u);
  assert.throws(() => normalizePromotionInput({ dryRun: "false", reviewedBatch: reviewedBatch.replace(p.name, "other") }), /scope/u);
});
