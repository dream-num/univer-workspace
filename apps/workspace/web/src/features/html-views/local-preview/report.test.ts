import { expect, it } from "vitest";
import { buildReport, localPreviewReportSchema, sha256Hex } from "./report";

const valid = {
  token: "t0123", sha256: "a".repeat(64),
  renderCheck: { status: "issues", issues: [{ kind: "uncaught-error", message: "boom" }], durationMs: 1200 },
  bindings: [{ attribute: "data-univer-cell-text", reference: "u:s:A1", sample: 42, warnings: ["empty"] }],
  leftoverPlaceholders: ["Loading…"], viewport: { width: 390, height: 800 }, writeMode: "trial",
};

it("parses the report preview.mjs prints", () => {
  expect(localPreviewReportSchema.parse(valid)).toEqual(valid);
  expect(JSON.parse(JSON.stringify(localPreviewReportSchema.parse(valid)))).toEqual(valid);
});

it("rejects reports outside the contract", () => {
  for (const bad of [
    { ...valid, sha256: "xyz" }, { ...valid, token: "" }, { ...valid, writeMode: "real" },
    { ...valid, renderCheck: { ...valid.renderCheck, status: "ok" } },
    { ...valid, bindings: [{ ...valid.bindings[0], warnings: ["odd"] }] },
    { ...valid, bindings: Array.from({ length: 61 }, () => valid.bindings[0]) },
    { ...valid, viewport: { width: -1, height: 1 } },
  ]) expect(localPreviewReportSchema.safeParse(bad).success).toBe(false);
});

it("hashes bytes the way sha256sum does", async () => {
  expect(await sha256Hex(new TextEncoder().encode("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  expect(() => buildReport({ ...valid, sha256: "no", bindings: [] } as never)).toThrow();
});
