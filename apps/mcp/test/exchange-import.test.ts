import { expect, it, vi } from "vitest";
import { WorkspaceContentSource } from "@univerjs/univer-workspace-client-core";
import { WorkspaceHttp } from "@univerjs/univer-workspace-client-core/product";
import { exchangeImport } from "../src/executor/ops/exchange-import.js";
import { zeroCost } from "../src/shared/usage.js";
import type { OpContext } from "../src/executor/context.js";

it("rejects oversized converted UnitData before any create/commit HTTP request", async () => {
  const fetcher = vi.fn<typeof fetch>();
  const http = new WorkspaceHttp({
    origin: "http://workspace.test",
    cookie: "workspace_session=test",
    role: "client",
    fetcher,
  });
  const source = new WorkspaceContentSource(http);
  const ctx: OpContext = {
    userId: "owner",
    requestId: "large",
    signal: new AbortController().signal,
    transportOrigin: http.origin,
    http: () => http,
    source: () => source,
    usage: { executor: "none", cost: { ...zeroCost } },
    runtime: { executeRead: vi.fn(), executeAndCommit: vi.fn(), exportUnitData: vi.fn() },
    exchange: {
      license: "",
      licenseKey: "",
      importBuffer: async () => ({ name: "Too large", content: "x".repeat(900 * 1024) }),
    },
  };
  await expect(
    exchangeImport(
      ctx,
      {
        worktreeId: "wt",
        spaceId: "space",
        fileName: "large.xlsx",
        idempotencyKey: "key",
      },
      new Uint8Array([0, 255]),
    ),
  ).rejects.toMatchObject({
    code: "workspace-import-too-large",
    detail: { maxBytes: 921600, size: 921633 },
  });
  expect(fetcher).not.toHaveBeenCalled();
  expect(ctx.usage.cost.committed_revisions).toBe(0);
});
