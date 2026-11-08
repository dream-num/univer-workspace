import { once } from "node:events";
import { createServer } from "node:http";
import { createCollaborationServerAdapter } from "@univer-cli/univer-collaboration-runtime";
import { UniverInstanceType } from "@univerjs/core";
import { describe, expect, it } from "vitest";
import { createWorkspaceContentWorkerConnection, parseWorkerInit } from "../src/content-worker.js";
import { parseWorkspaceRuntimeTarget } from "../src/runtime-target.js";

const init = {
  credential: "workspace_session=transport-test",
  license: "license",
  target: {
    origin: "https://identity.example.test",
    revision: 7,
    scope: { kind: "worktree", worktreeId: "wt / one" },
    unitId: "unit-1",
    unitType: "sheet",
  },
};

describe("Workspace content worker transport", () => {
  it("preserves the default init and rejects extra keys and invalid transport origins", () => {
    expect(parseWorkerInit(init)).toEqual(init);
    expect(parseWorkerInit({ ...init, transportOrigin: "http://localhost:3020/" })).toEqual({
      ...init,
      transportOrigin: "http://localhost:3020",
    });
    for (const transportOrigin of [
      undefined,
      null,
      1,
      "",
      "/relative",
      "ws://localhost",
      "https://a/path",
      "https://a?x=1",
      "https://a#fragment",
      "https://user:pass@a",
    ]) {
      expect(() => parseWorkerInit({ ...init, transportOrigin })).toThrow();
    }
    expect(() => parseWorkerInit({ ...init, extra: true })).toThrow(
      expect.objectContaining({ code: "WORKSPACE_RUNTIME_INIT_INVALID" }),
    );
  });

  it.each([
    [{ kind: "trunk" }, "/universer-api"],
    [{ kind: "worktree", worktreeId: "wt / one" }, "/universer-api/worktrees/wt%20%2F%20one"],
  ])(
    "routes HTTP and the adapter's WebSocket dial through transport for %j",
    async (scope, prefix) => {
      const requests: {
        path: string | undefined;
        cookie: string | undefined;
        origin: string | undefined;
        role: string | string[] | undefined;
      }[] = [];
      const upgrades: string[] = [];
      const server = createServer((request, response) => {
        requests.push({
          path: request.url,
          cookie: request.headers.cookie,
          origin: request.headers.origin,
          role: request.headers["x-univer-cli-sdk-role"],
        });
        request.resume();
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({ ticket: "ticket-1", loaded: true, committed: true }));
      });
      server.on("upgrade", (request, socket) => {
        upgrades.push(request.url ?? "");
        socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
      });
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      try {
        const address = server.address();
        if (address === null || typeof address === "string")
          throw new Error("Missing test server address");
        const transportOrigin = `http://127.0.0.1:${String(address.port)}`;
        const parsed = parseWorkerInit({
          ...init,
          target: { ...init.target, scope },
          transportOrigin,
        });
        const target = parseWorkspaceRuntimeTarget(parsed.target);
        const { http, serverConfig } = createWorkspaceContentWorkerConnection(parsed, target);
        expect(http.origin).toBe(init.target.origin);
        expect(target.origin).toBe(init.target.origin);
        expect(serverConfig.collabWebSocketUrl).toBe(`${transportOrigin}${prefix}/comb/connect`);
        expect(serverConfig.snapshotServerUrl).toBe(`${target.origin}${prefix}/snapshot`);
        expect(serverConfig.collabSubmitChangesetUrl).toBe(`${target.origin}${prefix}/comb`);
        expect(serverConfig.wsSessionTicketUrl).toBe(
          `${target.origin}/universer-api/user/session-ticket`,
        );
        const request = serverConfig.httpRequest;
        if (request === undefined) throw new Error("Missing collaboration HTTP transport");
        await expect(
          (await request(`${serverConfig.snapshotServerUrl}/2/unit/unit-1/rev/0`)).json(),
        ).resolves.toMatchObject({ loaded: true });
        await expect(
          (
            await request(`${serverConfig.collabSubmitChangesetUrl}/2/unit/unit-1/new_changes`, {
              method: "POST",
              body: "{}",
            })
          ).json(),
        ).resolves.toMatchObject({ committed: true });
        await expect(http.json("/api/reference-host")).resolves.toMatchObject({ loaded: true });
        await expect(
          request(`${transportOrigin}/must-not-bypass-origin-check`),
        ).rejects.toMatchObject({ code: "workspace-origin-mismatch" });

        const backend = createCollaborationServerAdapter(serverConfig);
        await expect(
          backend.open({ unitId: target.unitId, unitType: UniverInstanceType.UNIVER_SHEET }),
        ).rejects.toThrow();
        expect(upgrades).toEqual([`${prefix}/comb/connect?sessionTicket=ticket-1`]);
        expect(requests.map(({ path }) => path)).toEqual([
          `${prefix}/snapshot/2/unit/unit-1/rev/0`,
          `${prefix}/comb/2/unit/unit-1/new_changes`,
          "/api/reference-host",
          "/universer-api/user/session-ticket",
        ]);
        expect(
          requests.every(({ cookie, role }) => cookie === init.credential && role === "worker"),
        ).toBe(true);
        expect(requests[1]?.origin).toBe(target.origin);
      } finally {
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error === undefined ? resolve() : reject(error))),
        );
      }
    },
  );
});
