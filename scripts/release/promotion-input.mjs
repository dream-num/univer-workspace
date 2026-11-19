import { appendFile } from "node:fs/promises";

export function normalizePromotionInput({ dryRun, selection = "", reviewedBatch = "" }) {
  if (dryRun !== "true" && dryRun !== "false") throw Error("dry_run must be explicit");
  if (dryRun === "true" ? !selection.trim() || reviewedBatch.trim() : !reviewedBatch.trim() || selection.trim()) {
    throw Error(dryRun === "true"
      ? "Validation requires selection only"
      : "Submission requires only the reviewed_batch emitted by a successful validation run");
  }
  const raw = dryRun === "true" ? selection : reviewedBatch;
  const input = JSON.parse(raw);
  if (!Array.isArray(input?.packages) || !input.packages.length ||
      input.packages.some(p => p?.name !== "univer-workspace-cli")) {
    throw Error("Package outside this Trusted Publisher caller scope");
  }
  return JSON.stringify(input);
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  await appendFile(process.env.GITHUB_OUTPUT, "input=" + normalizePromotionInput({
    dryRun: process.env.PROMOTION_DRY_RUN,
    selection: process.env.PROMOTION_SELECTION,
    reviewedBatch: process.env.PROMOTION_REVIEWED_BATCH,
  }) + "\n");
}
