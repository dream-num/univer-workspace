import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createLocalPathInputSource,
  decodePathReference,
  pathReferenceFromUrl,
  pathReferenceInsert,
  pathReferenceUrl,
  resolvePathReference,
} from "../src/client/path-reference.ts";
import {
  createWorkspaceResourceInputSource,
  createWorkspaceResourceReferenceCodec,
  projectWorkspaceResourceMessageText,
  restoreReferenceDraftChips,
} from "../src/client/workspace-resource-reference.ts";
afterEach(() => vi.unstubAllGlobals());
const signal = new AbortController().signal;
describe("file and folder references", () => {
  it("restores persisted folder chips once without network access", () => {
    const ref = { kind: "local-folder" as const, path: "/tmp/reports", name: "Reports" };
    const draft = pathReferenceInsert(ref).clipboardText;
    let snapshot = {
      phase: "plain",
      draft,
      draftRev: 1,
      occurrences: [] as { offset: number; length: number }[],
    };
    const insertReference = vi.fn(() => {
      snapshot = { ...snapshot, draftRev: 2, occurrences: [{ offset: 0, length: draft.length }] };
      return true;
    });
    const input = { state: { getSnapshot: () => snapshot }, insertReference };
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    restoreReferenceDraftChips(input as never);
    restoreReferenceDraftChips(input as never);
    expect(insertReference).toHaveBeenCalledOnce();
    expect(insertReference.mock.calls[0]).toMatchObject([
      { appearance: "folder", source: "univer-workspace-local-path" },
      { start: 0, end: draft.length, draftRev: 1 },
    ]);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("preserves encoded path identity and uses a real folder chip", () => {
    const ref = {
      kind: "local-folder" as const,
      path: "/tmp/\u62a5\u544a [1] (copy)/",
      name: "Reports",
    };
    expect(pathReferenceFromUrl(pathReferenceUrl(ref), ref.name)).toEqual(ref);
    expect(pathReferenceUrl(ref)).toContain("%28copy%29");
    expect(pathReferenceInsert(ref).appearance).toBe("folder");
    expect(pathReferenceFromUrl("univer-local-path:%ZZ?kind=file", "bad")).toBeUndefined();
    expect(() => decodePathReference('{"kind":"workspace-folder","name":"A"}')).toThrow();
    expect(projectWorkspaceResourceMessageText(`Use ${JSON.stringify(ref)}`)).toContain(
      "@[Reports](univer-local-path:",
    );
  });
  it("selects remote folders independently from drilling and rechecks access at send time", async () => {
    const source = createWorkspaceResourceInputSource();
    const candidate = {
      name: "Reports",
      value: JSON.stringify({
        v: 1,
        kind: "browse",
        path: [
          { kind: "space", id: "s", name: "Team" },
          { kind: "folder", id: "n", name: "Reports" },
        ],
      }),
    };
    const picked = await source.onPick!({ candidate, action: "pick" } as never);
    expect(picked).toMatchObject({ insert: { appearance: "folder" } });
    expect(await source.onPick!({ candidate, action: "drill" } as never)).toMatchObject({
      continue: true,
    });
    const ref = JSON.stringify({
      kind: "workspace-folder",
      nodeId: "n",
      spaceId: "s",
      name: "Reports",
    });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          Response.json({ node: { id: "n", spaceId: "s", resource: null, name: "Renamed" } }),
        )
        .mockResolvedValueOnce(new Response("", { status: 403 })),
    );
    expect(
      JSON.parse(await createWorkspaceResourceReferenceCodec().serialize(ref, signal)),
    ).toEqual({ kind: "workspace-folder", nodeId: "n", spaceId: "s", name: "Renamed" });
    await expect(createWorkspaceResourceReferenceCodec().serialize(ref, signal)).rejects.toThrow(
      "unavailable",
    );
  });
  it("inserts local files and directories, quotes drilled whitespace and rejects changed file types", async () => {
    const source = createLocalPathInputSource({
      localFiles: "Local files",
      host: "Host",
      truncated: "Narrow the path",
    });
    const folder = { kind: "local-folder" as const, path: "/tmp/my files", name: "my files" };
    const candidate = { name: folder.name, value: JSON.stringify(folder) };
    expect(await source.onPick!({ candidate, action: "pick" } as never)).toMatchObject({
      insert: { appearance: "folder" },
    });
    expect(await source.onPick!({ candidate, action: "drill" } as never)).toEqual({
      text: '@"local:/tmp/my files/',
      continue: true,
    });
    const file = { kind: "local-file" as const, path: "/tmp/report.csv", name: "report.csv" };
    expect(
      await source.onPick!({
        candidate: { name: file.name, value: JSON.stringify(file) },
        action: "pick",
      } as never),
    ).toMatchObject({ insert: { appearance: "file" } });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(Response.json({ kind: "folder", path: file.path, name: file.name })),
    );
    await expect(resolvePathReference(file, signal)).rejects.toThrow("changed type");
  });
});
