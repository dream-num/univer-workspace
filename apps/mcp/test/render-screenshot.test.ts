import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceContentSource } from "@univerjs/univer-workspace-client-core";
import { WorkspaceHttp } from "@univerjs/univer-workspace-client-core/product";
import type { OpContext } from "../src/executor/context.js";
import { renderScreenshot } from "../src/executor/ops/render-screenshot.js";
import { screenshotTarget } from "../src/executor/ops/screenshot-target.js";
import { createRendererClient } from "../src/executor/renderer-client.js";
import { decodeFrame, encodeFrame } from "../src/shared/frame.js";
import { zeroCost } from "../src/shared/usage.js";

const session = "secret-session-value";
const origin = "https://workspace.test";
const token = "executor-token-".repeat(4);
const sheetData = {
  id: "unit",
  name: "Budget",
  appVersion: "1",
  locale: "enUS",
  styles: {},
  sheetOrder: ["budget"],
  sheets: { budget: { rowCount: 10, columnCount: 3 } },
};
const output = {
  unitId: "unit",
  unitType: "sheet",
  images: [{ name: "a.png", mediaType: "image/png", width: 1, height: 1, offset: 0, size: 3 }],
};

afterEach(() => vi.restoreAllMocks());

function setup() {
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
    unitType: "sheet" as const,
    revision: 3,
  });
  const trunk = vi
    .spyOn(source, "resolveTrunkRuntimeTarget")
    .mockResolvedValue(target({ kind: "trunk" }));
  const worktree = vi
    .spyOn(source, "resolveRuntimeTarget")
    .mockResolvedValue(target({ kind: "worktree", worktreeId: "wt-1" }));
  const exportUnitData = vi.fn<OpContext["runtime"]["exportUnitData"]>(async () =>
    JSON.parse(JSON.stringify(sheetData)),
  );
  const rendererFetch = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(
      async () =>
        new Response(
          new Uint8Array(
            encodeFrame(
              {
                ok: true,
                output,
                meta: { executor: "warm", cost: { ...zeroCost, render_pages: 1 } },
              },
              new Uint8Array([1, 2, 3]),
            ),
          ),
        ),
    );
  const ctx: OpContext = {
    http: () => http,
    source: () => source,
    userId: "owner",
    requestId: "shot",
    transportOrigin: origin,
    signal: new AbortController().signal,
    usage: { executor: "none", cost: { ...zeroCost } },
    runtime: { executeRead: vi.fn(), executeAndCommit: vi.fn(), exportUnitData },
    exchange: { license: "", licenseKey: "" },
    renderer: createRendererClient({
      url: "http://renderer:3000",
      rendererToken: token,
      requestId: "shot",
      deadlineAt: Date.now() + 30_000,
      signal: new AbortController().signal,
    }),
  };
  return { ctx, fetcher, trunk, worktree, exportUnitData, rendererFetch };
}
const sent = (rendererFetch: ReturnType<typeof setup>["rendererFetch"]) => {
  const [url, options] = rendererFetch.mock.calls[0]!;
  const frame = decodeFrame(Buffer.from(options?.body as Uint8Array));
  return {
    url: String(url),
    header: frame.header as Record<string, unknown>,
    raw: Buffer.from(options?.body as Uint8Array).toString("utf8"),
  };
};

describe("render.screenshot", () => {
  it("renders a trunk Unit and forwards the loaded unit and target without credentials", async () => {
    const f = setup();
    const result = await renderScreenshot(f.ctx, {
      scope: { kind: "trunk" },
      unitId: "unit",
      options: { range: "A1:B2", sheet: "Budget" },
    });
    expect(f.trunk).toHaveBeenCalledWith({ unitId: "unit" });
    expect(f.worktree).not.toHaveBeenCalled();
    expect(f.exportUnitData).toHaveBeenCalledWith({
      target: expect.objectContaining({ scope: { kind: "trunk" } }),
    });
    expect(result.output).toEqual(output);
    expect([...result.bytes]).toEqual([1, 2, 3]);
    expect(f.ctx.usage.cost.render_pages).toBe(1);
    const request = sent(f.rendererFetch);
    expect(request.url).toBe("http://renderer:3000/rpc/v1/screenshot");
    expect(request.header).toEqual({
      v: 1,
      op: "screenshot",
      requestId: "shot",
      deadlineMs: expect.any(Number),
      input: {
        unitType: "sheet",
        unitData: sheetData,
        target: { kind: "sheet-range", range: "A1:B2", sheetName: "Budget" },
      },
    });
    expect(request.raw).not.toContain(session);
    expect(request.raw).not.toContain(origin);
    expect(request.raw).not.toContain("grant");
    expect(f.fetcher).not.toHaveBeenCalled();
  });

  it("renders a Worktree Unit and attributes the call to its Space", async () => {
    const f = setup();
    await renderScreenshot(f.ctx, {
      scope: { kind: "worktree", worktreeId: "wt-1" },
      unitId: "unit",
      options: {},
    });
    expect(f.worktree).toHaveBeenCalledWith({ unitId: "unit", worktreeId: "wt-1" });
    expect(f.trunk).not.toHaveBeenCalled();
    expect(f.ctx.usage.repo).toBe("space-1");
    const request = sent(f.rendererFetch);
    expect((request.header["input"] as Record<string, unknown>)["target"]).toBeUndefined();
    expect(request.raw).not.toContain(session);
  });

  it("rejects bad arguments with the CLI's message before contacting the renderer", async () => {
    const f = setup();
    await expect(
      renderScreenshot(f.ctx, {
        scope: { kind: "trunk" },
        unitId: "unit",
        options: { sheet: "Budget" },
      }),
    ).rejects.toMatchObject({
      code: "workspace-argument-invalid",
      message: "--sheet requires --range",
    });
    await expect(
      renderScreenshot(f.ctx, {
        scope: { kind: "trunk" },
        unitId: "unit",
        options: { pages: "1" },
      }),
    ).rejects.toMatchObject({
      code: "workspace-argument-invalid",
      message: "--pages is not supported for Sheet",
    });
    expect(f.rendererFetch).not.toHaveBeenCalled();
  });

  it("fails clearly, after parsing, when no renderer is configured", async () => {
    const f = setup();
    const { renderer: _renderer, ...bare } = f.ctx;
    const ctx: OpContext = {
      ...bare,
      renderer: createRendererClient({
        url: undefined,
        rendererToken: token,
        requestId: "shot",
        deadlineAt: Date.now() + 30_000,
        signal: new AbortController().signal,
      }),
    };
    await expect(
      renderScreenshot(ctx, { scope: { kind: "trunk" }, unitId: "unit", options: {} }),
    ).rejects.toMatchObject({ wire: { code: "workspace-renderer-not-configured" } });
    expect(f.rendererFetch).not.toHaveBeenCalled();
  });
});

describe("screenshot target mapping", () => {
  const unit = (unitType: string) => ({ unitType, unitData: { id: "u" } }) as never;

  it.each([
    ["sheet", {}, undefined],
    ["sheet", { range: "B2:H4" }, { kind: "sheet-range", range: "B2:H4" }],
    ["slide", { pages: "1,3-4,cover" }, { kind: "slide-pages", pages: [1, 3, 4, "cover"] }],
    [
      "slide",
      { contactSlide: true, tile: "4x2" },
      { kind: "slide-pages", contactSheet: { tile: { columns: 4, rows: 2 } } },
    ],
    [
      "board",
      { elements: "a,b", padding: 8, scale: 2 },
      { kind: "board-content", elementIds: ["a", "b"], padding: 8, scale: 2 },
    ],
    [
      "board",
      { region: "0,1,20,30" },
      { kind: "board-content", region: { left: 0, top: 1, width: 20, height: 30 } },
    ],
    ["board", { padding: 4 }, { kind: "board-content", padding: 4 }],
    ["doc", {}, undefined],
    ["base", {}, undefined],
  ])("maps %s options %j", async (unitType, options, target) => {
    await expect(screenshotTarget(unit(unitType), options)).resolves.toEqual(target);
  });

  it.each([
    ["doc", { range: "A1" }, "--range is not supported for Doc"],
    ["slide", { tile: "4x2" }, "--tile requires --contact-slide"],
    ["slide", { pages: "3-1" }, 'Invalid --pages range "3-1"'],
    ["board", { region: "1,2,3" }, "--region must contain left,top,width,height as finite numbers"],
    [
      "board",
      { elements: "a", region: "0,0,1,1" },
      "--elements and --region cannot be used together",
    ],
    ["board", { scale: 2 }, "--scale requires --region or --elements"],
  ])("rejects %s options %j with the uvw message", async (unitType, options, message) => {
    await expect(screenshotTarget(unit(unitType), options)).rejects.toMatchObject({
      code: "workspace-argument-invalid",
      message,
    });
  });

  it("never lets the command exit the process", async () => {
    const exit = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit called");
    }) as never);
    await expect(screenshotTarget(unit("doc"), { range: "A1" })).rejects.toMatchObject({
      code: "workspace-argument-invalid",
    });
    expect(exit).not.toHaveBeenCalled();
  });
});
