import { describe, expect, it, vi } from "vitest";
vi.mock("@univer-cli/doc-markdown-facade", () => ({ resolveDocMarkdownReadAssets: vi.fn() }));
import { readWorkspaceMarkdownImage } from "../src/markdown-assets.js";

const id = "5f8b5e41-e035-425c-8a30-02d8ef338361";
const origin = "https://workspace.test";
const prefix = `/universer-api/worktrees/wt/file/${id}`;
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl9sAAAAASUVORK5CYII=",
  "base64",
);

describe("current Workspace native image resolution", () => {
  it.each([id, `${origin}${prefix}/content`, `${origin}/universer-api/file/${id}/content`])(
    "resolves only an authorized current Asset through the Worktree API: %s",
    async (reference) => {
      const request = vi.fn(async (path: string, _init: RequestInit) =>
        path.endsWith("/sign-url")
          ? Response.json({ error: { code: 1, message: "" }, url: `${prefix}/content` })
          : new Response(Uint8Array.from(png), {
              headers: { "content-type": "image/png", "content-length": String(png.length) },
            }),
      );
      const result = await readWorkspaceMarkdownImage(reference, {
        origin,
        worktreeId: "wt",
        request,
      });
      expect(result).toEqual({ data: new Uint8Array(png), mimeType: "image/png" });
      expect(request.mock.calls.map(([path]) => path)).toEqual([
        `${prefix}/sign-url`,
        `${prefix}/content`,
      ]);
      expect(request.mock.calls.every(([, init]) => init.redirect === "manual")).toBe(true);
    },
  );

  it.each([
    `https://other.test${prefix}/content`,
    `/universer-api/worktrees/other/file/${id}/content`,
    "file:///tmp/image.png",
    "file-asset://local-image",
    "/api/session",
  ])("rejects a non-Workspace image reference without a request: %s", async (reference) => {
    const request = vi.fn();
    await expect(
      readWorkspaceMarkdownImage(reference, { origin, worktreeId: "wt", request }),
    ).rejects.toMatchObject({ code: "workspace-markdown-asset-unavailable" });
    expect(request).not.toHaveBeenCalled();
  });

  it("rejects a cross-origin signed URL before any image download", async () => {
    const request = vi.fn(async () =>
      Response.json({ error: { code: 1, message: "" }, url: "https://other.test/image.png" }),
    );
    await expect(
      readWorkspaceMarkdownImage(id, { origin, worktreeId: "wt", request }),
    ).rejects.toThrow("same-origin");
    expect(request).toHaveBeenCalledTimes(1);
  });

  it.each([
    { "content-type": "text/html", "content-length": "3" },
    { "content-type": "image/png", "content-length": "99999999" },
    { "content-type": "image/png", "content-length": "1" },
  ])("rejects invalid image response metadata: %j", async (headers) => {
    const request = vi.fn(async (path: string) =>
      path.endsWith("/sign-url")
        ? Response.json({ error: { code: 1, message: "" }, url: `${prefix}/content` })
        : new Response(Uint8Array.from(png), { headers }),
    );
    await expect(
      readWorkspaceMarkdownImage(id, { origin, worktreeId: "wt", request }),
    ).rejects.toMatchObject({ code: "workspace-markdown-asset-unavailable" });
  });
});
