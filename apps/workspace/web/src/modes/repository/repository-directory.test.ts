import { describe, expect, it } from "vitest";
import { filterRepositories, parseRepositorySearch } from "./repository-directory";
import type { components } from "../../../../generated/http/schema.js";

type Space = components["schemas"]["SpaceView"];
const spaces = [
  {
    id: "personal",
    type: "personal",
    name: "Wei 的个人空间",
    description: "",
    publicRead: false,
    owner: { id: "wei", username: "weimin" },
  },
  {
    id: "finance",
    type: "team",
    name: "Finance",
    description: "季度预算",
    publicRead: false,
    owner: { id: "wei", username: "weimin" },
  },
  {
    id: "crm",
    type: "team",
    name: "mini-crm",
    description: "Sales",
    publicRead: true,
    owner: { id: "li", username: "li" },
  },
] as Space[];
const nameOf = (space: Space) => (space.type === "personal" ? "weimin" : space.name);

describe("repository directory", () => {
  it("searches the displayed personal name, descriptions and case-insensitive names", () => {
    expect(filterRepositories(spaces, { q: " WEIMIN " }, nameOf, "en-US").map((s) => s.id)).toEqual(
      ["finance", "personal"],
    );
    expect(filterRepositories(spaces, { q: "季度" }, nameOf, "zh-CN").map((s) => s.id)).toEqual([
      "finance",
    ]);
    expect(filterRepositories(spaces, { q: "sales" }, nameOf, "en-US").map((s) => s.id)).toEqual([
      "crm",
    ]);
  });

  it("combines type and visibility, and sorts without mutating cached data", () => {
    expect(
      filterRepositories(spaces, { type: "team", visibility: "private" }, nameOf, "en-US").map(
        (s) => s.id,
      ),
    ).toEqual(["finance"]);
    expect(filterRepositories(spaces, { sort: "desc" }, nameOf, "en-US").map((s) => s.id)).toEqual([
      "personal",
      "crm",
      "finance",
    ]);
    expect(spaces.map((s) => s.id)).toEqual(["personal", "finance", "crm"]);
  });

  it("drops invalid URL filters and bounds free text", () => {
    expect(
      parseRepositorySearch({ type: "admin", visibility: true, sort: "random", q: {} }),
    ).toEqual({});
    expect(
      parseRepositorySearch({
        type: "team",
        visibility: "public",
        sort: "desc",
        q: "a".repeat(500),
      }),
    ).toEqual({ type: "team", visibility: "public", sort: "desc", q: "a".repeat(200) });
  });
});
