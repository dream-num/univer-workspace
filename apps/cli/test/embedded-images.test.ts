import type { IMutation } from "@univerjs/protocol";
import { describe, expect, it, vi } from "vitest";
import {
  externalizeEmbeddedImages,
  type WorkspaceEmbeddedImageUploader,
} from "../src/features/content/embedded-images.js";

describe("Workspace embedded image externalization", () => {
  const png = `data:image/png;base64,${Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString(
    "base64",
  )}`;

  it("uploads each unique binary once and rewrites all nested reference shapes", async () => {
    const upload = vi.fn(async () => "file-1");
    const mutations = [
      mutation({
        drawing: { imageSourceType: "BASE64", source: png },
        nested: [{ fillImageSource: png, fillImageSourceType: "BASE64" }],
      }),
      mutation({ image: { source: png, sourceType: "BASE64" } }),
    ];

    const result = await externalizeEmbeddedImages({
      mutations,
      unitId: "unit-1",
      uploader: { upload },
      worktreeId: "wt-1",
    });

    expect(upload).toHaveBeenCalledOnce();
    expect(upload).toHaveBeenCalledWith(
      expect.objectContaining({
        bytes: Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]),
        filename: expect.stringMatching(/\.png$/u),
        mediaType: "image/png",
        unitId: "unit-1",
        worktreeId: "wt-1",
      }),
    );
    expect(result.map(({ data }) => JSON.parse(data))).toEqual([
      {
        drawing: { imageSourceType: "UUID", source: "file-1" },
        nested: [{ fillImageSource: "file-1", fillImageSourceType: "UUID" }],
      },
      { image: { source: "file-1", sourceType: "UUID" } },
    ]);
  });

  it("externalizes images inside serialized resource data without mutating the input", async () => {
    const upload = vi.fn(async () => "file-1");
    const resourceData = JSON.stringify({
      data: { drawing: { imageSourceType: "BASE64", source: png } },
    });
    const mutations = [
      mutation({ resources: [{ data: resourceData, name: "SHEET_DRAWING_PLUGIN" }] }),
    ];

    const result = await externalizeEmbeddedImages({
      mutations,
      unitId: "unit-1",
      uploader: { upload },
      worktreeId: "wt-1",
    });

    expect(upload).toHaveBeenCalledOnce();
    const rewritten = JSON.parse(result[0]!.data) as { resources: Array<{ data: string }> };
    expect(JSON.parse(rewritten.resources[0]!.data)).toMatchObject({
      data: { drawing: { imageSourceType: "UUID", source: "file-1" } },
    });
    expect(JSON.parse(mutations[0]!.data)).toEqual({
      resources: [{ data: resourceData, name: "SHEET_DRAWING_PLUGIN" }],
    });
  });

  it("preserves unsupported images and upload failures byte-for-byte", async () => {
    const upload = vi.fn<WorkspaceEmbeddedImageUploader["upload"]>(async () => {
      throw new Error("offline");
    });
    const svg = "data:image/svg+xml;base64,PHN2Zy8+";
    const mutations = [
      mutation({ imageSourceType: "BASE64", source: png }),
      mutation({
        imageSourceType: "BASE64",
        source: svg,
      }),
    ];

    await expect(
      externalizeEmbeddedImages({
        mutations,
        unitId: "unit-1",
        uploader: { upload },
        worktreeId: "wt-1",
      }),
    ).resolves.toBe(mutations);
    expect(upload).toHaveBeenCalledOnce();
  });
});

function mutation(data: unknown): IMutation {
  return { data: JSON.stringify(data), id: "sheet.mutation.test" };
}
