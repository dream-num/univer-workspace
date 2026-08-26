import { describe, expect, it } from "vitest";
import * as host from "../src/index.js";
import { createDocument, narrowSpaces, newIdempotencyKey, narrowNodes } from "../src/provider/workspace-api.js";
import { spaceLinksDomainSpec } from "../src/provider/space-links.js";
import type { WorkspaceHttpClient } from "@univerjs/univer-workspace-harness";

/** A WorkspaceHttpClient stub answering queued `(path, init)` rounds. */
function stubClient(rounds: Array<(path: string) => Response>): WorkspaceHttpClient {
  let index = 0;
  return {
    origin: "https://workspace.test",
    sessionToken: "tok",
    async request(path: string): Promise<Response> {
      const round = rounds[Math.min(index, rounds.length - 1)];
      if (round === undefined) throw new Error("stub client ran out of rounds");
      index += 1;
      return await Promise.resolve(round(path));
    },
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("dsh-univer-workspace-plugin", () => {
  it("exports a loadable cordis host plugin", () => {
    expect(host.name).toBe("dsh-univer-workspace-plugin");
    expect(typeof host.apply).toBe("function");
  });

  it("narrows a Workspace space list", () => {
    const spaces = narrowSpaces({
      spaces: [
        { id: "sp-1", type: "personal", name: "Personal", accessRole: "owner" },
        { id: "sp-2", type: "team", name: "Team", accessRole: "editor" },
      ],
    });
    expect(spaces).toHaveLength(2);
    expect(spaces[0]).toMatchObject({ spaceId: "sp-1", type: "personal", name: "Personal", accessRole: "owner" });
    expect(spaces[1]).toMatchObject({ spaceId: "sp-2", type: "team", accessRole: "editor" });
  });

  it("rejects a malformed space list", () => {
    expect(() => narrowSpaces({})).toThrow(/no spaces array/);
  });

  it("declares a versioned space-links domain", () => {
    expect(spaceLinksDomainSpec.name).toBe("univer_workspace_space_links");
    expect(spaceLinksDomainSpec.version).toBe(1);
  });

  it("mints a valid Idempotency-Key", () => {
    const key = newIdempotencyKey();
    expect(key).toMatch(/^uwh-[a-z0-9]+-[A-Za-z0-9_-]+$/);
    expect(key.length).toBeGreaterThanOrEqual(16);
    expect(newIdempotencyKey()).not.toBe(key);
  });

  it("keeps a listed document usable without a list-level unitId", () => {
    const documents = narrowNodes({
      nodes: [
        {
          id: "node-1",
          name: "Demo Sheet",
          resource: { id: "res-1", kind: "univer", unitType: "sheet", capabilities: {} },
          accessRole: "editor",
        },
      ],
    }, "sp-1");
    expect(documents).toHaveLength(1);
    const [first] = documents;
    if (first === undefined) throw new Error("expected one document");
    expect(first).toMatchObject({ nodeId: "node-1", resourceId: "res-1", unitType: "sheet" });
    expect(first.unitId).toBeNull();
  });

  it("creates a document and resolves the unitId through the open endpoint", async () => {
    const client = stubClient([
      path => {
        expect(path).toBe("/api/resources");
        return jsonResponse(201, {
          operation: { id: "op-1", state: "completed" },
          node: {
            id: "node-2",
            name: "New Sheet",
            resource: { id: "res-2", kind: "univer", unitType: "sheet", capabilities: {} },
            accessRole: "owner",
          },
        });
      },
      path => {
        expect(path).toBe("/api/resources/res-2/open");
        return jsonResponse(200, {
          resource: {
            id: "res-2", kind: "univer", nodeId: "node-2", spaceId: "sp-1", name: "New Sheet",
            unitId: "unit-2", unitType: "sheet", accessRole: "owner", editorMode: "edit",
          },
        });
      },
    ]);
    const created = await createDocument(client, {
      spaceId: "sp-1", parentNodeId: null, name: "New Sheet", unitType: "sheet",
    });
    expect(created).toEqual({ resourceId: "res-2", nodeId: "node-2", unitId: "unit-2" });
  });

  it("re-sends the same Idempotency-Key until a 202 create replays its result", async () => {
    const keys: string[] = [];
    const createAnswer = (state: "pending" | "completed"): Response => jsonResponse(
      state === "pending" ? 202 : 200,
      state === "pending"
        ? { operation: { id: "op-1", state: "pending" } }
        : {
            operation: { id: "op-1", state: "completed" },
            node: {
              id: "node-3",
              name: "Retry Sheet",
              resource: { id: "res-3", kind: "univer", unitType: "sheet", capabilities: {} },
              accessRole: "owner",
            },
          },
    );
    const client: WorkspaceHttpClient = {
      origin: "https://workspace.test",
      sessionToken: "tok",
      async request(path, init) {
        if (path === "/api/resources") {
          const headers = (init?.headers ?? {}) as Record<string, string>;
          if (typeof headers["Idempotency-Key"] === "string") keys.push(headers["Idempotency-Key"]);
          return await Promise.resolve(createAnswer(keys.length === 1 ? "pending" : "completed"));
        }
        expect(path).toBe("/api/resources/res-3/open");
        return await Promise.resolve(jsonResponse(200, {
          resource: {
            id: "res-3", kind: "univer", nodeId: "node-3", spaceId: "sp-1", name: "Retry Sheet",
            unitId: "unit-3", unitType: "sheet", accessRole: "owner", editorMode: "edit",
          },
        }));
      },
    };
    const created = await createDocument(client, {
      spaceId: "sp-1", parentNodeId: null, name: "Retry Sheet", unitType: "sheet",
    });
    expect(created).toEqual({ resourceId: "res-3", nodeId: "node-3", unitId: "unit-3" });
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });
});
