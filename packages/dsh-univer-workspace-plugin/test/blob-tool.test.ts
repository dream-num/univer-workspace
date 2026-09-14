import { mkdtemp, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Context } from "@deepseek-ai/cordis";
import type { ToolDefinition, ToolRunContext } from "@deepseek-ai/dsh-tools";
import { it, expect } from "vitest";
import { registerBlobTool } from "../src/tools/blob.ts";

it("replaces session files with authenticated ETags and rejects unsafe paths, missing keys and account changes", async () => {
  const root = await mkdtemp(join(tmpdir(), "dsh-blob-"));
  try {
    await writeFile(join(root, "edit.txt"), "edited");
    await symlink(tmpdir(), join(root, "escape"));
    let currentUser = "user-1";
    let calls = 0;
    const auth = {
      switching: () => false,
      currentIdentity: () => ({ userId: currentUser }),
      // The real provider creates a new structural client on each call.
      currentClient: () => ({
        origin: "https://workspace.test",
        sessionToken: "test-session",
        request: async (path: string, init?: RequestInit) => {
          calls++;
          expect(path).toBe("/api/blob-resources/blob-1/content");
          const request = new Request(`https://workspace.test${path}`, init);
          expect(request.headers.get("if-match")).toBe('"downloaded"');
          expect(await request.text()).toBe("edited");
          return Response.json({
            operationId: "blob-replace-request-0001",
            resourceId: "blob-1",
            etag: '"new"',
          });
        },
      }),
    };
    let tool!: ToolDefinition;
    const ctx = {
      get: (name: string) =>
        name === "workspaceAuth"
          ? auth
          : { resolveSpaceForSession: async () => ({ userId: "user-1", spaceId: "space-1" }) },
      tools: {
        register: (definition: ToolDefinition) => {
          tool = definition;
          return () => undefined;
        },
      },
    } as unknown as Context;
    registerBlobTool(ctx);
    const exec = { agent: { session: { header: { cwd: root } } } } as ToolRunContext;
    const args = {
      action: "replace",
      resourceId: "blob-1",
      file: "edit.txt",
      etag: '"downloaded"',
      idempotencyKey: "blob-replace-request-0001",
    };
    expect(await tool.execute(args, exec)).toMatchObject({ resourceId: "blob-1", etag: '"new"' });
    await expect(
      tool.execute({ ...args, file: "escape/outside.txt", action: "download" }, exec),
    ).rejects.toThrow(/inside the session workspace/);
    await expect(
      tool.execute(
        Object.fromEntries(Object.entries(args).filter(([key]) => key !== "idempotencyKey")),
        exec,
      ),
    ).rejects.toThrow(/idempotencyKey/);
    currentUser = "other-user";
    await expect(tool.execute(args, exec)).rejects.toThrow(/connection is unavailable/);
    expect(calls).toBe(1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
