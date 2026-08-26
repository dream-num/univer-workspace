import { describe, expect, it } from "vitest";
import * as host from "../src/index.js";
import { BRAND_TOKEN_OVERRIDES, SKIN_CSS } from "../src/client/palette.js";

describe("dsh-univer-workspace-skin-plugin", () => {
  it("exports a loadable cordis host plugin", () => {
    expect(host.name).toBe("dsh-univer-workspace-skin-plugin");
    expect(typeof host.apply).toBe("function");
  });

  it("overrides the brand tokens in both light and dark modes", () => {
    expect(BRAND_TOKEN_OVERRIDES.length).toBeGreaterThan(0);
    expect(SKIN_CSS).toContain("--dsw-alias-brand-primary:#2563eb");
    expect(SKIN_CSS).toContain("body[data-ds-dark-theme]");
    expect(SKIN_CSS).toContain("--dsw-alias-brand-primary:#3b82f6");
  });
});
