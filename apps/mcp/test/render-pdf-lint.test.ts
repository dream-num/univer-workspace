import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceContentSource } from "@univerjs/univer-workspace-client-core";
import { WorkspaceHttp } from "@univerjs/univer-workspace-client-core/product";
import type { OpContext } from "../src/executor/context.js";
import { renderLint } from "../src/executor/ops/render-lint.js";
import { renderPrintPdf } from "../src/executor/ops/render-print-pdf.js";
import { createRendererClient } from "../src/executor/renderer-client.js";
import { decodeFrame, encodeFrame } from "../src/shared/frame.js";
import { zeroCost } from "../src/shared/usage.js";

const session = "secret-session-value";
const origin = "https://workspace.test";
const token = "internal-token-".repeat(4);
const unitData = { id: "unit", name: "Unit", appVersion: "1", locale: "enUS" };
const pdfOutput = {
  unitId: "unit",
  unitType: "doc",
  name: "Report",
  mediaType: "application/pdf",
  pageCount: 2,
};
const lintOutput = {
  kind: "unit-layout-lint",
  unitId: "unit",
  unitType: "slide",
  coverage: { pages: [{ page: 1, pageId: "p1" }], rules: ["text-off-page"] },
  findings: [{ id: "f1", page: 1, rule: "text-off-page" }],
};

afterEach(() => vi.restoreAllMocks());

function setup(unitType: string, output: object, payload?: Uint8Array, pages = 2) {
  const fetcher = vi.fn<typeof fetch>(async (url) => {
    if (String(url).endsWith("/api/worktrees/wt-1"))
      return Response.json({
        worktree: {
          id: "wt-1",
          name: "PR",
          state: "draft",
          number: 3,
          teamSpace: { id: "space-1" },
        },
      });
    throw new Error(`Unexpected Workspace request ${String(url)}`);
  });
  const http = new WorkspaceHttp({
    origin,
    role: "client",
    cookie: `workspace_session=${session}`,
    fetcher,
  });
  const source = new WorkspaceContentSource(http);
  const target = (scope: { kind: "trunk" } | { kind: "worktree"; worktreeId: string }) => ({
    origin,
    scope,
    unitId: "unit",
    unitType: unitType as "doc",
    revision: 3,
  });
  const trunk = vi
    .spyOn(source, "resolveTrunkRuntimeTarget")
    .mockResolvedValue(target({ kind: "trunk" }));
  const worktree = vi
    .spyOn(source, "resolveRuntimeTarget")
    .mockResolvedValue(target({ kind: "worktree", worktreeId: "wt-1" }));
  const rendererFetch = vi.spyOn(globalThis, "fetch").mockImplementation(
    async () =>
      new Response(
        new Uint8Array(
          encodeFrame(
            {
              ok: true,
              output,
              meta: { executor: "warm", cost: { ...zeroCost, render_pages: pages } },
            },
            payload,
          ),
        ),
      ),
  );
  const ctx: OpContext = {
    http: () => http,
    source: () => source,
    userId: "owner",
    requestId: "render",
    transportOrigin: origin,
    signal: new AbortController().signal,
    usage: { executor: "none", cost: { ...zeroCost } },
    runtime: {
      executeRead: vi.fn(),
      executeAndCommit: vi.fn(),
      exportUnitData: vi.fn(async () => JSON.parse(JSON.stringify(unitData))),
    },
    exchange: { license: "", licenseKey: "" },
    renderer: createRendererClient({
      url: "http://renderer:3000",
      internalToken: token,
      requestId: "render",
      deadlineAt: Date.now() + 30_000,
      signal: new AbortController().signal,
    }),
  };
  return { ctx, fetcher, trunk, worktree, rendererFetch };
}
const sent = (rendererFetch: ReturnType<typeof setup>["rendererFetch"]) => {
  const [url, options] = rendererFetch.mock.calls[0]!;
  const raw = Buffer.from(options?.body as Uint8Array);
  return {
    url: String(url),
    header: decodeFrame(raw).header as Record<string, unknown>,
    raw: raw.toString("utf8"),
  };
};
const noCredentials = (raw: string) => {
  expect(raw).not.toContain(session);
  expect(raw).not.toContain(origin);
  expect(raw).not.toContain("grant");
};

describe("render.printPdf", () => {
  it("prints a trunk Unit and forwards only the loaded unit", async () => {
    const f = setup("doc", pdfOutput, new Uint8Array([1, 2, 3]));
    const result = await renderPrintPdf(f.ctx, { scope: { kind: "trunk" }, unitId: "unit" });
    expect(f.trunk).toHaveBeenCalledWith({ unitId: "unit" });
    expect(f.worktree).not.toHaveBeenCalled();
    expect(result.output).toEqual(pdfOutput);
    expect([...result.bytes]).toEqual([1, 2, 3]);
    expect(f.ctx.usage.cost.render_pages).toBe(2);
    expect(f.ctx.usage.unitType).toBe("doc");
    const request = sent(f.rendererFetch);
    expect(request.url).toBe("http://renderer:3000/rpc/v1/printPdf");
    expect(request.header).toMatchObject({
      op: "printPdf",
      input: { unitType: "doc", unitData },
    });
    noCredentials(request.raw);
    expect(f.fetcher).not.toHaveBeenCalled();
  });

  it("prints a Worktree Unit and attributes the call to its Space", async () => {
    const f = setup("sheet", { ...pdfOutput, unitType: "sheet" }, new Uint8Array([1]));
    await renderPrintPdf(f.ctx, {
      scope: { kind: "worktree", worktreeId: "wt-1" },
      unitId: "unit",
    });
    expect(f.worktree).toHaveBeenCalledWith({ unitId: "unit", worktreeId: "wt-1" });
    expect(f.trunk).not.toHaveBeenCalled();
    expect(f.ctx.usage.repo).toBe("space-1");
    noCredentials(sent(f.rendererFetch).raw);
  });

  it("rejects a Base Unit with the CLI's message before contacting the renderer", async () => {
    const f = setup("base", pdfOutput);
    await expect(
      renderPrintPdf(f.ctx, { scope: { kind: "trunk" }, unitId: "unit" }),
    ).rejects.toMatchObject({
      code: "workspace-print-pdf-type-unsupported",
      message: "Base Units do not support PDF printing.",
    });
    expect(f.rendererFetch).not.toHaveBeenCalled();
  });
});

describe("render.lint", () => {
  it("lints a Worktree Slide and forwards the loaded Slide and page selectors", async () => {
    const f = setup("slide", lintOutput, undefined, 1);
    const result = await renderLint(f.ctx, {
      worktreeId: "wt-1",
      unitId: "unit",
      pages: "1,3-4,cover",
    });
    expect(f.worktree).toHaveBeenCalledWith({ unitId: "unit", worktreeId: "wt-1" });
    expect(result.output).toEqual(lintOutput);
    expect(f.ctx.usage.cost.render_pages).toBe(1);
    expect(f.ctx.usage.repo).toBe("space-1");
    const request = sent(f.rendererFetch);
    expect(request.url).toBe("http://renderer:3000/rpc/v1/lint");
    expect(request.header).toMatchObject({
      op: "lint",
      input: { unitType: "slide", unitData, pages: [1, 3, 4, "cover"] },
    });
    noCredentials(request.raw);
    expect(f.fetcher).toHaveBeenCalledTimes(1);
  });

  it("lints every page when none are selected", async () => {
    const f = setup("slide", lintOutput, undefined, 1);
    await renderLint(f.ctx, { worktreeId: "wt-1", unitId: "unit" });
    expect(
      (sent(f.rendererFetch).header["input"] as Record<string, unknown>)["pages"],
    ).toBeUndefined();
  });

  it("rejects a non-Slide Unit with the CLI's code and message", async () => {
    const f = setup("sheet", lintOutput);
    await expect(renderLint(f.ctx, { worktreeId: "wt-1", unitId: "unit" })).rejects.toMatchObject({
      code: "workspace-unit-layout-lint-unit-type-unsupported",
      message: "Slide layout lint requires a Slide Unit; unit is sheet.",
    });
    expect(f.rendererFetch).not.toHaveBeenCalled();
  });

  it("keeps the loader's own error code, upper case included", async () => {
    const f = setup("slide", lintOutput);
    const missing = Object.assign(new Error("Unit unit is not in Worktree wt-1."), {
      code: "WORKSPACE_UNIT_NOT_FOUND",
    });
    f.worktree.mockRejectedValueOnce(missing);
    await expect(renderLint(f.ctx, { worktreeId: "wt-1", unitId: "unit" })).rejects.toBe(missing);
    expect(f.rendererFetch).not.toHaveBeenCalled();
  });

  it.each([
    ["3-1", "Invalid page selector: 3-1"],
    [" ", "--pages cannot be empty"],
  ])("rejects pages %j with the uvw message", async (pages, message) => {
    const f = setup("slide", lintOutput);
    await expect(
      renderLint(f.ctx, { worktreeId: "wt-1", unitId: "unit", pages }),
    ).rejects.toMatchObject({ code: "workspace-argument-invalid", message });
    expect(f.rendererFetch).not.toHaveBeenCalled();
  });
});
