import { mkdtemp, writeFile, readFile, rm, symlink, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Context } from "@deepseek-ai/cordis";
import type { ToolDefinition, ToolRunContext } from "@deepseek-ai/dsh-tools";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { WorkspaceApiError } from "../src/provider/api-errors.ts";
import { registerBlobTool } from "../src/tools/blob.ts";

let root: string;
let tool: ToolDefinition;
let exec: ToolRunContext;
const service = {
  resolveSpaceForSession: async () => ({ userId: "user-1", spaceId: "space-1" }),
  replaceBlob: vi.fn(async () => ({ resourceId: "blob-1", etag: '"new"' })),
  downloadBlob: vi.fn(async () => ({
    bytes: Buffer.from("downloaded"),
    etag: '"downloaded"',
    mediaType: "text/plain",
  })),
};
const args = {
  action: "replace",
  resourceId: "blob-1",
  file: "edit.txt",
  etag: '"downloaded"',
  idempotencyKey: "blob-replace-request-0001",
};

beforeEach(async () => {
  vi.clearAllMocks();
  root = await realpath(await mkdtemp(join(tmpdir(), "dsh-blob-")));
  await writeFile(join(root, "edit.txt"), "edited");
  const ctx = {
    get: (name: string) => (name === "univerWorkspace" ? service : undefined),
    tools: {
      register: (definition: ToolDefinition) => {
        tool = definition;
        return () => undefined;
      },
    },
  } as unknown as Context;
  registerBlobTool(ctx);
  exec = { agent: { session: { header: { cwd: root } } } } as ToolRunContext;
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("Blob tool", () => {
  it("passes a session file and downloaded ETag to the Workspace service", async () => {
    await expect(tool.execute(args, exec)).resolves.toMatchObject({ etag: '"new"' });
    expect(service.replaceBlob).toHaveBeenCalledWith("user-1", {
      resourceId: "blob-1",
      bytes: Buffer.from("edited"),
      etag: args.etag,
      idempotencyKey: args.idempotencyKey,
    });
  });

  it("downloads through the service into a session-relative path", async () => {
    await tool.execute({ action: "download", resourceId: "blob-1", file: "output.txt" }, exec);
    expect(service.downloadBlob).toHaveBeenCalledWith("user-1", "blob-1");
    expect(await readFile(join(root, "output.txt"), "utf8")).toBe("downloaded");
  });

  it("preserves precondition errors through the existing tool error boundary", async () => {
    service.replaceBlob.mockRejectedValueOnce(
      new WorkspaceApiError("Blob content changed; download it again", 412, "PRECONDITION_FAILED"),
    );
    await expect(tool.execute(args, exec)).rejects.toMatchObject({
      code: "WORKSPACE_PRECONDITION_FAILED",
    });
  });

  it("rejects output paths escaping the session before calling the service", async () => {
    await symlink(tmpdir(), join(root, "escape"));
    await expect(
      tool.execute({ ...args, file: "escape/outside.txt", action: "download" }, exec),
    ).rejects.toThrow(/inside the session workspace/);
    expect(service.downloadBlob).not.toHaveBeenCalled();
  });

  it("requires a stable replacement key before calling the service", async () => {
    const { idempotencyKey, ...withoutKey } = args;
    await expect(tool.execute(withoutKey, exec)).rejects.toThrow(/idempotencyKey/);
    expect(service.replaceBlob).not.toHaveBeenCalled();
  });
});
