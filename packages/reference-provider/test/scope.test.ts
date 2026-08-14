import {
  WORKSPACE_REFERENCE_SCOPE_CONFORMANCE_CASES,
  WorkspaceReferenceProviderError,
  createWorkspaceReferenceLoadContext,
  createWorkspaceReferenceScopePolicy,
  readWorkspaceReferenceSourceScope,
} from "../src/index.js";
import { describe, expect, it } from "vitest";

describe("Workspace Reference scope policy", () => {
  for (const scenario of WORKSPACE_REFERENCE_SCOPE_CONFORMANCE_CASES) {
    it(scenario.name, () => {
      expect(
        createWorkspaceReferenceScopePolicy(scenario.hostContext).select(
          scenario.sourceUnitId,
        ),
      ).toEqual(scenario.expected);
    });
  }

  it("roundtrips the application-only load context", () => {
    const scope = {
      kind: "mergePreview",
      unitId: "source-unit",
      worktreeId: "worktree-1",
    } as const;
    expect(
      readWorkspaceReferenceSourceScope(
        createWorkspaceReferenceLoadContext(scope),
        "source-unit",
      ),
    ).toEqual(scope);
  });

  it("uses an absent tag for the Host default scope", () => {
    expect(readWorkspaceReferenceSourceScope({})).toBeUndefined();
  });

  it("rejects a load context bound to another Source Unit", () => {
    expect(() =>
      readWorkspaceReferenceSourceScope(
        createWorkspaceReferenceLoadContext({
          kind: "trunk",
          unitId: "source-a",
        }),
        "source-b",
      ),
    ).toThrowError(
      expect.objectContaining<Partial<WorkspaceReferenceProviderError>>({
        code: "invalid-load-context",
      }),
    );
  });
});
