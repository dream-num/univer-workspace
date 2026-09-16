import { afterEach, expect, it, vi } from "vitest";
import { resolveHtmlViewSource } from "../src/client/html-views/source.ts";
import { retainUntilSaved } from "../src/client/html-views/retained-preview.ts";

afterEach(() => vi.unstubAllGlobals());

it.each(["edit", "readOnly"])(
  "resolves the source via product authority (%s)",
  async (editorMode) => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ resource: { id: "resource" } }))
      .mockResolvedValueOnce(
        Response.json({
          resource: {
            id: "resource",
            kind: "univer",
            unitId: "unit",
            unitType: "sheet",
            editorMode,
          },
        }),
      );
    vi.stubGlobal("fetch", fetch);
    const signal = new AbortController().signal;
    expect(await resolveHtmlViewSource("unit", signal)).toEqual({ editorMode });
    expect(fetch.mock.calls).toEqual([
      [
        "/univer-workspace/api/unit-resources/unit",
        expect.objectContaining({ method: "GET", signal, credentials: "same-origin" }),
      ],
      [
        "/univer-workspace/api/resources/resource/open",
        expect.objectContaining({ method: "POST", signal }),
      ],
    ]);
  },
);
it.each([
  { unitId: "other" },
  { unitType: "doc" },
  { id: "other" },
  { kind: "blob" },
  { editorMode: "unknown" },
])("rejects mismatched or unauthorized source metadata %j", async (override) => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce(Response.json({ resource: { id: "resource" } }))
      .mockResolvedValueOnce(
        Response.json({
          resource: {
            id: "resource",
            kind: "univer",
            unitId: "unit",
            unitType: "sheet",
            editorMode: "edit",
            ...override,
          },
        }),
      ),
  );
  await expect(resolveHtmlViewSource("unit", new AbortController().signal)).rejects.toThrow(
    "accessible Sheet",
  );
});
it.each([401, 403, 409])(
  "does not open a source after access/fence rejection %s",
  async (status) => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status }));
    vi.stubGlobal("fetch", fetch);
    await expect(resolveHtmlViewSource("unit", new AbortController().signal)).rejects.toThrow(
      String(status),
    );
    expect(fetch).toHaveBeenCalledOnce();
  },
);
it("keeps the page alive until save confirms and coalesces repeated close attempts", async () => {
  let finish!: () => void;
  const flush = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const dispose = vi.fn();
  const owner = retainUntilSaved({ flush, dispose, onSaving: vi.fn(), onError: vi.fn() });
  const first = owner.saveAndClose();
  expect(owner.saveAndClose()).toBe(first);
  await Promise.resolve();
  expect(dispose).not.toHaveBeenCalled();
  finish();
  await first;
  await owner.saveAndClose();
  expect(flush).toHaveBeenCalledOnce();
  expect(dispose).toHaveBeenCalledOnce();
});
it("keeps failed saves available for retry instead of disposing", async () => {
  const flush = vi
    .fn()
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce(undefined);
  const dispose = vi.fn();
  const onError = vi.fn();
  const owner = retainUntilSaved({ flush, dispose, onSaving: vi.fn(), onError });
  await owner.saveAndClose();
  expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "offline" }));
  expect(dispose).not.toHaveBeenCalled();
  await owner.saveAndClose();
  expect(dispose).toHaveBeenCalledOnce();
});

it("permits explicit discard after a failed save and never resumes that page", async () => {
  const flush = vi.fn().mockRejectedValue(new Error("permission revoked"));
  const dispose = vi.fn();
  const owner = retainUntilSaved({ flush, dispose, onSaving: vi.fn(), onError: vi.fn() });
  await owner.saveAndClose();
  owner.discard();
  owner.discard();
  await owner.saveAndClose();
  expect(flush).toHaveBeenCalledOnce();
  expect(dispose).toHaveBeenCalledOnce();
});
