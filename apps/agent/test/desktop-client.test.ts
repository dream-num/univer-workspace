import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { WebBootGraph } from "@deepseek-ai/dsh-client-modules";
import { exportDesktopClient } from "../src/desktop-client-artifact.ts";

describe("production desktop client artifact", () => {
  it("exports SDK responses without maps, hashes the transformed bytes, and keeps the SDK graph intact", async () => {
    const directory = await mkdtemp(join(tmpdir(), "desktop-client-"));
    try {
      const graph: WebBootGraph = {
        rev: "sdk-rev",
        entries: [{ id: "client", url: "/plugins/??client/client.js&rev=old", rev: "old" }],
        batches: [
          {
            phase: "bootstrap",
            url: "/plugins/??client/client.js&rev=old",
            rev: "old",
            entries: ["client"],
          },
        ],
      };
      const requests: string[] = [];
      await exportDesktopClient(
        {
          graph: () => graph,
          fetchBundle(request) {
            requests.push(request.url);
            return new Response(
              "window.client = true;\n//# sourceMappingURL=/plugins/client.js.map\n",
            );
          },
        },
        directory,
      );
      const artifact = JSON.parse(await readFile(join(directory, "manifest.json"), "utf8"));
      expect(requests).toHaveLength(1);
      expect(requests[0]).not.toContain(".map");
      const row = artifact.graph.entries[0];
      const script = await readFile(join(directory, artifact.files[row.url]), "utf8");
      expect(script).toBe("window.client = true;\n");
      expect(row.rev).toBe(createHash("sha256").update(script).digest("hex"));
      expect(artifact.graph.batches[0].url).toBe(row.url);
      expect(artifact.graph.entries[0].id).toBe("client");
      expect(graph.rev).toBe("sdk-rev");
      expect(graph.entries[0]?.rev).toBe("old");
      expect((await readdir(directory)).some((file) => file.endsWith(".map"))).toBe(false);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it("fails packaging when DSH cannot provide a declared script", async () => {
    const directory = await mkdtemp(join(tmpdir(), "desktop-client-"));
    try {
      await expect(
        exportDesktopClient(
          {
            graph: () => ({
              rev: "r",
              entries: [{ id: "x", rev: "r", url: "/x" }],
              batches: [{ phase: "bootstrap", url: "/x", rev: "r", entries: ["x"] }],
            }),
            fetchBundle: () => new Response(null, { status: 404 }),
          },
          directory,
        ),
      ).rejects.toThrow("404");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
