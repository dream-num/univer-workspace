import { describe, expect, it } from "vitest";
import * as host from "../src/index.js";
import { narrowSpaces } from "../src/provider/workspace-api.js";
import { spaceLinksDomainSpec } from "../src/provider/space-links.js";

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
});
