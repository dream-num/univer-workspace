import type { IMutation } from "@univerjs/protocol";
import { describe, expect, it, vi } from "vitest";
import {
  createWorkspaceEmbeddedImageUploader,
  externalizeEmbeddedImages,
  WorkspaceHttp,
  type WorkspaceEmbeddedImageUploader,
} from "../src/index.js";

const signatures = {
  gif: Buffer.from("GIF89a", "ascii"),
  jpeg: Buffer.from([0xff, 0xd8, 0xff, 0x00]),
  png: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  webp: Buffer.concat([Buffer.from("RIFF", "ascii"), Buffer.alloc(4), Buffer.from("WEBP", "ascii")]),
};

describe("Workspace embedded image externalization", () => {
  it("deduplicates bytes and rewrites all direct and serialized reference shapes immutably", async () => {
    const png = dataUri("image/png", signatures.png);
    const upload = vi.fn<WorkspaceEmbeddedImageUploader["upload"]>(async () => "file-1");
    const resourceData = JSON.stringify({
      drawing: { imageSourceType: "BASE64", source: png },
    });
    const mutations = [
      mutation({
        drawing: { imageSourceType: "BASE64", source: png },
        nested: [{ fillImageSource: png, fillImageSourceType: "BASE64" }],
        resources: [{ data: resourceData, name: "SHEET_DRAWING_PLUGIN" }],
      }),
      mutation({ image: { source: png, sourceType: "BASE64" } }),
    ];
    const original = mutations.map(({ data }) => data);

    const result = await externalizeEmbeddedImages({
      mutations,
      unitId: "unit-1",
      uploader: { upload },
      worktreeId: "wt-1",
    });

    expect(upload).toHaveBeenCalledOnce();
    expect(upload).toHaveBeenCalledWith(
      expect.objectContaining({
        bytes: Uint8Array.from(signatures.png),
        filename: expect.stringMatching(/\.png$/u),
        mediaType: "image/png",
        unitId: "unit-1",
        worktreeId: "wt-1",
      }),
    );
    const first = JSON.parse(result[0]!.data) as {
      drawing: Record<string, unknown>;
      nested: Array<Record<string, unknown>>;
      resources: Array<{ data: string }>;
    };
    expect(first.drawing).toEqual({ imageSourceType: "UUID", source: "file-1" });
    expect(first.nested[0]).toEqual({ fillImageSource: "file-1", fillImageSourceType: "UUID" });
    expect(JSON.parse(first.resources[0]!.data)).toEqual({
      drawing: { imageSourceType: "UUID", source: "file-1" },
    });
    expect(JSON.parse(result[1]!.data)).toEqual({
      image: { source: "file-1", sourceType: "UUID" },
    });
    expect(mutations.map(({ data }) => data)).toEqual(original);
  });

  it.each([
    ["image/png", signatures.png, "png"],
    ["image/jpeg", signatures.jpeg, "jpg"],
    ["image/gif", signatures.gif, "gif"],
    ["image/webp", signatures.webp, "webp"],
  ] as const)("accepts canonical %s bytes with the matching signature", async (mediaType, bytes, extension) => {
    const upload = vi.fn(async () => "file-1");

    const result = await externalizeEmbeddedImages({
      mutations: [mutation({ imageSourceType: "BASE64", source: dataUri(mediaType, bytes) })],
      unitId: "unit-1",
      uploader: { upload },
      worktreeId: "wt-1",
    });

    expect(upload).toHaveBeenCalledWith(
      expect.objectContaining({ bytes: Uint8Array.from(bytes), filename: expect.stringMatching(new RegExp(`\\.${extension}$`, "u")), mediaType }),
    );
    expect(JSON.parse(result[0]!.data)).toEqual({ imageSourceType: "UUID", source: "file-1" });
  });

  it("rejects noncanonical, mismatched and unsupported image sources byte-for-byte", async () => {
    const png = signatures.png.toString("base64");
    const sources = [
      "data:image/png;base64,",
      `data:image/png;base64,${png.slice(0, -1)}`,
      `data:image/png;base64,${png} `,
      "data:image/png;base64,%89PNG",
      dataUri("image/jpeg", signatures.png),
      "data:image/svg+xml;base64,PHN2Zy8+",
      "DATA:image/svg+xml;charset=utf-8;BASE64,PHN2Zy8+",
    ];
    const mutations = sources.map((source) => mutation({ imageSourceType: "BASE64", source }));
    const upload = vi.fn(async () => "file-1");

    await expect(
      externalizeEmbeddedImages({ mutations, unitId: "unit-1", uploader: { upload }, worktreeId: "wt-1" }),
    ).resolves.toBe(mutations);
    expect(upload).not.toHaveBeenCalled();
  });

  it("accepts exactly 20 MiB and rejects 20 MiB plus one", async () => {
    const limit = 20 * 1024 * 1024;
    const accepted = Buffer.alloc(limit);
    signatures.png.copy(accepted);
    const rejected = Buffer.alloc(limit + 1);
    signatures.png.copy(rejected);
    const upload = vi.fn<WorkspaceEmbeddedImageUploader["upload"]>(async () => "file-1");

    const result = await externalizeEmbeddedImages({
      mutations: [
        mutation({ imageSourceType: "BASE64", source: dataUri("image/png", accepted) }),
        mutation({ imageSourceType: "BASE64", source: dataUri("image/png", rejected) }),
      ],
      unitId: "unit-1",
      uploader: { upload },
      worktreeId: "wt-1",
    });

    expect(upload).toHaveBeenCalledOnce();
    expect(upload.mock.calls[0]![0].bytes).toHaveLength(limit);
    expect(JSON.parse(result[0]!.data)).toEqual({ imageSourceType: "UUID", source: "file-1" });
    expect(result[1]).toBeDefined();
    expect(result[1]!.data).toContain(dataUri("image/png", rejected));
  });

  it.each([
    ["upload failure", async () => { throw new Error("offline"); }],
    ["empty FileId", async () => ""],
  ])("preserves the original array after %s", async (_label, upload) => {
    const mutations = [
      mutation({ imageSourceType: "BASE64", source: dataUri("image/png", signatures.png) }),
      { data: "{invalid-json", id: "invalid" },
    ];

    await expect(
      externalizeEmbeddedImages({
        mutations,
        unitId: "unit-1",
        uploader: { upload } as WorkspaceEmbeddedImageUploader,
        worktreeId: "wt-1",
      }),
    ).resolves.toBe(mutations);
  });

  it("uploads through the exact authenticated Worktree File API", async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ FileId: "file-1" }), {
        headers: { "content-type": "application/json" },
        status: 200,
      }),
    );
    const uploader = createWorkspaceEmbeddedImageUploader(
      new WorkspaceHttp({
        cookie: "fixture-cookie",
        fetcher,
        origin: "https://workspace.test",
        role: "client",
      }),
    );

    await expect(
      uploader.upload({
        bytes: Uint8Array.from(signatures.png),
        filename: "digest.png",
        mediaType: "image/png",
        unitId: "unit / one",
        worktreeId: "wt / one",
      }),
    ).resolves.toBe("file-1");
    const [url, request] = fetcher.mock.calls[0]!;
    expect(String(url)).toBe(
      "https://workspace.test/universer-api/worktrees/wt%20%2F%20one/stream/file/upload?assign=unit+%2F+one&size=8&source=3",
    );
    expect(request).toMatchObject({ method: "POST", body: expect.any(FormData) });
    const form = request?.body instanceof FormData ? request.body : undefined;
    const file = form?.get("file");
    expect(file).toMatchObject({ name: "digest.png", size: 8, type: "image/png" });
  });
});

function dataUri(mediaType: string, bytes: Uint8Array): string {
  return `data:${mediaType};base64,${Buffer.from(bytes).toString("base64")}`;
}

function mutation(data: unknown): IMutation {
  return { data: JSON.stringify(data), id: "sheet.mutation.test" };
}
