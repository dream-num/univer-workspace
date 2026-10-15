import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { post, remove } = vi.hoisted(() => ({ post: vi.fn(), remove: vi.fn() }));
vi.mock("../../shared/api/client", () => ({
  api: { POST: post, DELETE: remove },
}));
import { importDocument, uploadBlob } from "./node-transfers";

const file = new File(["abc"], "sample.csv", { type: "text/csv" });
const reserved = {
  upload: { id: "upload-1" },
  uploadTarget: { contentUrl: "/content" },
};
const fetchMock = vi.fn();
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("fetch", fetchMock);
  remove.mockResolvedValue({});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Blob 上传", () => {
  it.each([false, true])("保留错误策略并尽力撤销：解析响应=%s", async (readResponseError) => {
    post.mockResolvedValue({ data: reserved });
    fetchMock.mockResolvedValue(Response.json({ error: { message: "服务端拒绝" } }, { status: 400 }));
    remove.mockRejectedValue(new Error("撤销失败"));
    await expect(uploadBlob("space", null, file, "上传失败", readResponseError)).rejects.toThrow(
      readResponseError ? "服务端拒绝" : "上传失败",
    );
    expect(remove).toHaveBeenCalledWith("/api/blob-upload-sessions/{uploadId}", {
      params: { path: { uploadId: "upload-1" } },
    });
  });

  it("上传原始字节，完成后返回结果，不撤销成功的上传", async () => {
    post.mockResolvedValueOnce({ data: reserved }).mockResolvedValueOnce({ data: { node: { id: "node" } } });
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
    await expect(uploadBlob("space", null, file)).resolves.toEqual({
      node: { id: "node" },
    });
    expect(post.mock.calls[0]?.[1]).toMatchObject({
      params: { header: { "Idempotency-Key": expect.any(String) } },
      body: {
        spaceId: "space",
        parentNodeId: null,
        name: file.name,
        byteSize: 3,
        declaredMediaType: "text/csv",
      },
    });
    expect(fetchMock).toHaveBeenCalledWith("/content", expect.objectContaining({ method: "PUT", body: file }));
    expect(remove).not.toHaveBeenCalled();
  });

  it("完成失败会撤销；缺少目标时不上传字节", async () => {
    post.mockResolvedValueOnce({ data: reserved }).mockResolvedValueOnce({ error: { error: { message: "完成失败" } } });
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
    await expect(uploadBlob("space", null, file)).rejects.toThrow("完成失败");
    expect(remove).toHaveBeenCalledTimes(1);
    post.mockResolvedValueOnce({ data: { upload: { id: "missing" } } });
    await expect(uploadBlob("space", null, file)).rejects.toThrow("File upload failed.");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("文档导入", () => {
  it.each([false, true])("保留完成条件：要求 Unit ID=%s", async (requireUnitId) => {
    vi.useFakeTimers();
    fetchMock
      .mockResolvedValueOnce(Response.json({ FileId: "file-1" }))
      .mockResolvedValueOnce(Response.json({ taskID: "task/1" }))
      .mockResolvedValueOnce(Response.json({ status: "done" }))
      .mockResolvedValueOnce(Response.json({ status: "done", import: { unitID: "unit-1" } }));
    const result = importDocument("space", null, file, "导入失败", requireUnitId);
    await vi.runAllTimersAsync();
    await expect(result).resolves.toBe(requireUnitId ? "unit-1" : undefined);
    expect(fetchMock).toHaveBeenCalledTimes(requireUnitId ? 4 : 3);
    expect(JSON.parse(fetchMock.mock.calls[1]?.[1].body)).toEqual({
      fileID: "file-1",
      outputType: 1,
      spaceId: "space",
      parentNodeId: null,
    });
    expect(fetchMock.mock.calls[2]?.[0]).toBe("/universer-api/exchange/task/task%2F1");
  });

  it.each([false, true])("保留空错误字符串：要求 Unit ID=%s", async (requireUnitId) => {
    fetchMock
      .mockResolvedValueOnce(Response.json({ FileId: "file-1" }))
      .mockResolvedValueOnce(Response.json({ taskID: "task-1" }))
      .mockResolvedValueOnce(Response.json({ status: "failed", error: { message: "" } }));
    await expect(importDocument("space", null, file, "导入失败", requireUnitId)).rejects.toMatchObject({
      message: requireUnitId ? "导入失败" : "",
    });
  });
});
