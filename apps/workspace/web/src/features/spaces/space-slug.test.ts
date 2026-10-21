import { expect, it } from "vitest";
import { isValidSlug, suggestSlug } from "./space-slug";

it("suggests the same slug as the server and leaves unusable names empty", () => {
  expect(suggestSlug("My Docs!")).toBe("my-docs");
  expect(suggestSlug("  --Team_A.b  ")).toBe("team_a.b");
  expect(suggestSlug("文档")).toBe("");
  expect(suggestSlug("Personal")).toBe("");
  expect(suggestSlug("x".repeat(150))).toHaveLength(100);
});

it("validates the slug format and the reserved word", () => {
  for (const slug of ["a", "Repo.1", "my_repo-2", "x".repeat(100)]) expect(isValidSlug(slug)).toBe(true);
  for (const slug of ["", "-a", ".a", "a b", "a/b", "PERSONAL", "x".repeat(101), "文档"]) {
    expect(isValidSlug(slug)).toBe(false);
  }
});
