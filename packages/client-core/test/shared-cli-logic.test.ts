import { describe, expect, it } from "vitest";
import {
  assertSpaceFilter,
  createRepo,
  issueApiUsername,
  LABEL_COLORS,
  listIssues,
  nodeMoveParent,
  repoEditPatch,
  resolveItemTarget,
  selectRepos,
} from "../src/product.js";
import type { WorkspaceIssueFeature, WorkspaceSpace, WorkspaceSpaceFeature } from "../src/product.js";

const flag = (parameter: string) => `--${parameter.replaceAll("_", "-")}`;

const origin = async () => "https://workspace.test";
const repo = async () => ({ spaceId: "s1" });
const space = (id: string, type: "personal" | "team", username: string, role = "viewer") =>
  ({ id, name: id, type, accessRole: role, owner: { id: username, username } }) as WorkspaceSpace;

describe("selectRepos", () => {
  const spaces = [
    space("a", "personal", "Alice", "owner"),
    space("b", "team", "bob"),
    space("c", "team", "bob"),
  ];
  it("filters by type, owner (case-folded ASCII, @me) and limit", () => {
    expect(selectRepos(spaces, { limit: 9, type: "team" }).map((s) => s.id)).toEqual(["b", "c"]);
    expect(selectRepos(spaces, { limit: 9, owner: "ALICE" }).map((s) => s.id)).toEqual(["a"]);
    expect(selectRepos(spaces, { limit: 9, owner: "@me" }).map((s) => s.id)).toEqual(["a"]);
    expect(selectRepos(spaces, { limit: 1, owner: "bob" }).map((s) => s.id)).toEqual(["b"]);
  });
});

describe("resolveItemTarget", () => {
  it("accepts numbers, matching URLs and Worktree IDs; rejects the rest", async () => {
    expect(await resolveItemTarget("#12", "issue", origin, repo)).toEqual({
      kind: "number",
      number: 12,
      spaceId: "s1",
    });
    expect(
      await resolveItemTarget("https://workspace.test/spaces/s2/issues/3", "issue", origin, repo),
    ).toEqual({ kind: "number", number: 3, spaceId: "s2" });
    expect(await resolveItemTarget("wt-1", "pr", origin, repo)).toEqual({ kind: "id", id: "wt-1" });
    await expect(resolveItemTarget("x", "issue", origin, repo)).rejects.toMatchObject({
      code: "workspace-argument-invalid",
      message: 'Issue number must look like 12 or #12, got "x".',
    });
    await expect(
      resolveItemTarget("https://other.test/spaces/s2/issues/3", "issue", origin, repo),
    ).rejects.toMatchObject({ code: "workspace-origin-mismatch" });
    await expect(
      resolveItemTarget("https://workspace.test/spaces/s2/pulls/3", "issue", origin, repo),
    ).rejects.toMatchObject({
      message: '"https://workspace.test/spaces/s2/pulls/3" does not point at an issue.',
    });
  });
});

describe("listIssues", () => {
  it("follows cursors until the limit and spells @me for the API", async () => {
    const seen: unknown[] = [];
    const feature = {
      async list(input: { cursor?: string; limit?: number }) {
        seen.push(input);
        return input.cursor === undefined
          ? { issues: [{ number: 1 }, { number: 2 }], nextCursor: "n" }
          : { issues: [{ number: 3 }], nextCursor: null };
      },
    } as unknown as WorkspaceIssueFeature;
    expect((await listIssues(feature, {}, 3)).map((i) => i.number)).toEqual([1, 2, 3]);
    expect(seen).toEqual([{ limit: 3 }, { limit: 1, cursor: "n" }]);
    expect(issueApiUsername("@me")).toBe("me");
    expect(issueApiUsername("bob")).toBe("bob");
  });
});

describe("assertSpaceFilter", () => {
  it("allows a Unit type only with univer or no resource kind and spells names as the caller does", () => {
    expect(() => assertSpaceFilter({ unitType: "sheet" })).not.toThrow();
    expect(() => assertSpaceFilter({ resourceKind: "univer", unitType: "sheet" })).not.toThrow();
    expect(() => assertSpaceFilter({ resourceKind: "blob" })).not.toThrow();
    for (const resourceKind of ["none", "blob"] as const) {
      expect(() => assertSpaceFilter({ resourceKind, unitType: "sheet" }, flag)).toThrowError(
        expect.objectContaining({
          code: "workspace-argument-invalid",
          message: "--unit-type can only be combined with --resource-kind univer.",
        }),
      );
    }
    expect(() => assertSpaceFilter({ resourceKind: "none", unitType: "doc" })).toThrowError(
      expect.objectContaining({
        message: "unit_type can only be combined with resource_kind univer.",
      }),
    );
  });
});

describe("nodeMoveParent", () => {
  it("returns the parent or null for root and demands exactly one of them", () => {
    expect(nodeMoveParent({ parent: "n1" })).toBe("n1");
    expect(nodeMoveParent({ parent: "n1", root: false })).toBe("n1");
    expect(nodeMoveParent({ root: true })).toBeNull();
    for (const input of [{}, { root: false }, { parent: "n1", root: true }]) {
      expect(() => nodeMoveParent(input, flag)).toThrowError(
        expect.objectContaining({
          code: "workspace-argument-invalid",
          message: "Exactly one of --parent <node> or --root is required.",
        }),
      );
    }
  });
});

describe("createRepo", () => {
  const spaceOf = (id: string, name: string) => ({ id, name }) as WorkspaceSpace;
  it("defaults the name to the slug and sets the description in a second call", async () => {
    const calls: unknown[] = [];
    const spaces = {
      async create(input: unknown) {
        calls.push(["create", input]);
        return spaceOf("s1", "docs");
      },
      async update(id: string, input: unknown) {
        calls.push(["update", id, input]);
        return spaceOf(id, "docs");
      },
    } as unknown as WorkspaceSpaceFeature;
    await createRepo(spaces, { slug: "docs" });
    await createRepo(spaces, { slug: "docs", name: "Docs", public: true, description: "x".repeat(350) });
    expect(calls).toEqual([
      ["create", { name: "docs", slug: "docs" }],
      ["create", { name: "Docs", slug: "docs", publicRead: true }],
      ["update", "s1", { description: "x".repeat(350) }],
    ]);
  });

  it("refuses a description over 350 characters before any request", async () => {
    const spaces = {
      create: () => Promise.reject(new Error("must not run")),
    } as unknown as WorkspaceSpaceFeature;
    const tooLong = { slug: "docs", description: ` ${"x".repeat(351)}` };
    await expect(createRepo(spaces, tooLong, flag)).rejects.toMatchObject({
      code: "workspace-argument-invalid",
      message: "--description must contain at most 350 characters.",
    });
  });
});

describe("repoEditPatch", () => {
  it("maps visibility to publicRead and keeps an empty description", () => {
    expect(repoEditPatch({ visibility: "public" })).toEqual({ publicRead: true });
    expect(repoEditPatch({ visibility: "private", description: "", slug: "s", name: "N" })).toEqual({
      name: "N",
      description: "",
      publicRead: false,
      slug: "s",
    });
  });

  it("names the fields the caller accepts when nothing changes, and ignores the others", () => {
    expect(() => repoEditPatch({}, ["name", "description", "visibility"], flag)).toThrowError(
      expect.objectContaining({
        code: "workspace-argument-invalid",
        message: "Nothing to change: pass --name, --description or --visibility.",
      }),
    );
    expect(() => repoEditPatch({})).toThrowError(
      expect.objectContaining({
        message: "Nothing to change: pass name, description, visibility or slug.",
      }),
    );
    expect(() => repoEditPatch({ slug: "s" }, ["name", "description", "visibility"])).toThrowError(
      expect.objectContaining({ code: "workspace-argument-invalid" }),
    );
  });
});

describe("LABEL_COLORS", () => {
  it("lists the eight palette names the Browser offers", () => {
    expect(LABEL_COLORS).toEqual(["gray", "blue", "green", "yellow", "orange", "red", "purple", "pink"]);
  });
});
