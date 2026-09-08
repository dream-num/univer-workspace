import { describe, expect, it } from "vitest";
import {
  createWorkspaceSessionContextMessage,
  narrowWorkspaceSessionContextResource,
  workspaceSessionContextKey,
} from "../src/session-context.ts";

const resource = {
  resourceId: "resource-1",
  unitId: "unit-1",
  unitType: "sheet" as const,
  nodeId: "node-1",
  spaceId: "space-1",
  name: "Budget",
  accessRole: "editor" as const,
};

function payload(overrides: Record<string, unknown> = {}) {
  return {
    resource: {
      id: resource.resourceId,
      kind: "univer",
      unitId: resource.unitId,
      unitType: resource.unitType,
    },
    node: {
      id: resource.nodeId,
      spaceId: resource.spaceId,
      name: resource.name,
      accessRole: resource.accessRole,
      resource: {
        id: resource.resourceId,
        kind: "univer",
        unitId: resource.unitId,
        unitType: resource.unitType,
      },
    },
    ...overrides,
  };
}

describe("Workspace Session context", () => {
  it("isolates the same Session across Workspace origins and users", () => {
    const a = workspaceSessionContextKey("https://a.example", "user|one", "session-1");
    const b = workspaceSessionContextKey("https://a.example", "user-two", "session-1");
    const c = workspaceSessionContextKey("https://b.example", "user|one", "session-1");

    expect(new Set([a, b, c]).size).toBe(3);
    expect(a).toMatch(/^[a-zA-Z0-9_-]+$/);
    expect(a).not.toContain("%");
  });

  it("accepts only a self-consistent, accessible Univer Resource descriptor", () => {
    expect(narrowWorkspaceSessionContextResource(payload(), resource.resourceId)).toEqual(resource);
    expect(narrowWorkspaceSessionContextResource(payload(), "another-resource")).toBeUndefined();
    expect(
      narrowWorkspaceSessionContextResource(
        payload({ resource: { id: resource.resourceId, kind: "blob" } }),
        resource.resourceId,
      ),
    ).toBeUndefined();
  });

  it("projects stable Resource identities as one plugin snapshot message", () => {
    const message = createWorkspaceSessionContextMessage([resource]);

    expect(message.role).toBe("user");
    expect(message.source).toMatchObject({
      kind: "plugin",
      plugin: "dsh-univer-workspace-plugin",
      form: "snapshot",
    });
    expect(message.content).toEqual([
      {
        type: "text",
        text: expect.stringContaining('"resourceId":"resource-1"'),
      },
    ]);
  });
});
