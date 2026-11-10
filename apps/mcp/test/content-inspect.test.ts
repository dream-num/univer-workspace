import { describe, expect, it, vi } from "vitest";
import type { OpContext } from "../src/executor/context.js";
import { contentInspect } from "../src/executor/ops/content-inspect.js";
import { zeroCost } from "../src/shared/usage.js";

type InspectionOptions = Pick<
  Parameters<typeof contentInspect>[1],
  "target" | "selectors" | "worksheet"
>;

function context(): OpContext {
  return {
    requestId: "inspect-input-test",
    userId: "user",
    transportOrigin: "https://workspace.test",
    signal: new AbortController().signal,
    usage: { executor: "none", cost: { ...zeroCost } },
    http: vi.fn(),
    source: vi.fn(),
    runtime: { executeRead: vi.fn(), executeAndCommit: vi.fn(), exportUnitData: vi.fn() },
    exchange: { license: "", licenseKey: "" },
  };
}

describe("content.inspect input errors", () => {
  it.each<{ input: InspectionOptions; message: string }>([
    {
      input: { target: "range", selectors: ["A1:B2"] },
      message: "range requires the worksheet argument (id:<id>, name:<name> or index:N)",
    },
    {
      input: { target: "range", selectors: ["A1:E6"], worksheet: "b764cbb9-uuid" },
      message: 'Invalid worksheet "b764cbb9-uuid"; use id:<id>, name:<name> or index:N.',
    },
    {
      input: { target: "worksheet", selectors: ["index:1"], worksheet: "name:Sheet1" },
      message: "worksheet is only valid when target is range, not worksheet",
    },
    {
      input: { target: "paragraph", selectors: ["index:0"] },
      message: 'Invalid index "0"; indices start at 1',
    },
    {
      input: { target: "paragraph", selectors: ["x:1"] },
      message: 'Unknown paragraph selector prefix "x"; use id: or index:',
    },
  ])("returns MCP wording: $message", async ({ input, message }) => {
    await expect(
      contentInspect(context(), { unitId: "unit", scope: { kind: "trunk" }, ...input }),
    ).rejects.toMatchObject({ code: "workspace-argument-invalid", message });
  });

  it.each(["id:sheet-uuid", "name:Sheet1", "index:1"])(
    "accepts the explicit worksheet form %s before resolving a source",
    async (worksheet) => {
      const ctx = context();
      const resolved = new Error("source reached");
      vi.mocked(ctx.source).mockImplementation(() => { throw resolved; });
      await expect(contentInspect(ctx, {
        unitId: "unit", scope: { kind: "trunk" }, target: "range", selectors: ["A1:E6"], worksheet,
      })).rejects.toBe(resolved);
      expect(ctx.source).toHaveBeenCalledOnce();
    },
  );

  const invalidInputs: InspectionOptions[] = [
    ...(["worksheet", "paragraph", "slide", "board-element"] as const).flatMap(
      (target) =>
        [[], ["x:1"], ["0"], ["id:"]].map((selectors) => ({
          target,
          selectors,
        })),
    ),
    ...(["worksheet", "paragraph", "slide"] as const).flatMap((target) =>
      ["index:abc", "index:1.5", "index:0", "index:-1"].map((selector) => ({
        target,
        selectors: [selector],
      })),
    ),
    ...(["workbook", "document", "presentation", "base", "board"] as const).map(
      (target) => ({ target, selectors: ["id:1"] }),
    ),
    ...([
      "workbook", "worksheet", "document", "paragraph", "presentation", "slide",
      "base", "board", "board-element",
    ] as const).map((target) => ({ target, worksheet: "name:Sheet1" })),
    { target: "range", selectors: ["A1:B2"] },
    { target: "range", worksheet: "name:Sheet1" },
    ...["x:1", "0", "index:abc", "index:0"].map((worksheet): InspectionOptions => ({
      target: "range", selectors: ["A1:B2"], worksheet,
    })),
  ];

  it.each(invalidInputs)("never mentions CLI flags or CLI: %j", async (input) => {
    const ctx = context();
    await expect(
      contentInspect(ctx, { unitId: "unit", scope: { kind: "trunk" }, ...input }),
    ).rejects.toMatchObject({
      code: "workspace-argument-invalid",
      message: expect.not.stringMatching(/(^|\s)--[a-z]|\bCLI\b/),
    });
    expect(ctx.source).not.toHaveBeenCalled();
    expect(ctx.runtime.executeRead).not.toHaveBeenCalled();
  });
});
