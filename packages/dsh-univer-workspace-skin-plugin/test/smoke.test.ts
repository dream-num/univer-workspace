import { describe, expect, it } from "vitest";
import * as host from "../src/index.js";
import { BRAND_TOKEN_OVERRIDES } from "../src/client/palette.js";
import { WORKSPACE_FAVICON_DATA_URI } from "../src/client/favicon.js";
import { WORKSPACE_MANIFEST_JSON, rewriteWorkspaceIndexBranding } from "../src/branding.js";

describe("dsh-univer-workspace-skin-plugin", () => {
  it("exports a loadable cordis host plugin", () => {
    expect(host.name).toBe("dsh-univer-workspace-skin-plugin");
    expect(typeof host.apply).toBe("function");
  });

  it("overrides the brand tokens in both light and dark modes", () => {
    expect(BRAND_TOKEN_OVERRIDES.length).toBeGreaterThan(0);
    expect(BRAND_TOKEN_OVERRIDES).toContainEqual({
      token: "--dsw-alias-brand-primary",
      light: "#2563eb",
      dark: "#3b82f6",
    });
  });

  it("ships the Workspace mark as a self-contained favicon asset", () => {
    expect(WORKSPACE_FAVICON_DATA_URI).toMatch(/^data:image\/svg\+xml,/u);
    expect(WORKSPACE_FAVICON_DATA_URI).not.toContain("DeepSeek");
  });

  it("owns the first-paint title, favicon, and manifest", () => {
    const branded = rewriteWorkspaceIndexBranding(
      '<html><head><title>DeepSeek Harness</title><link rel="icon" href="/deepseek.svg"></head></html>',
    );
    expect(branded).toContain("Univer Workspace Harness");
    expect(branded).toContain('id="uwh-workspace-favicon"');
    expect(JSON.parse(WORKSPACE_MANIFEST_JSON)).toMatchObject({ name: "Univer Workspace Harness" });
  });
});
