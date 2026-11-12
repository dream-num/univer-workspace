import { describe, expect, it } from "vitest";
import * as host from "../src/index.js";
import { WORKSPACE_FAVICON_DATA_URI } from "../src/client/favicon.js";
import { WORKSPACE_MANIFEST_JSON, rewriteWorkspaceIndexBranding } from "../src/branding.js";

describe("dsh-univer-workspace-skin-plugin", () => {
  it("exports a loadable cordis host plugin", () => {
    expect(host.name).toBe("dsh-univer-workspace-skin-plugin");
    expect(typeof host.apply).toBe("function");
  });

  it("ships the Workspace mark as a self-contained favicon asset", () => {
    expect(WORKSPACE_FAVICON_DATA_URI).toMatch(/^data:image\/svg\+xml,/u);
    expect(WORKSPACE_FAVICON_DATA_URI).not.toContain("DeepSeek");
  });

  it("owns the first-paint title, favicon, and manifest", () => {
    const branded = rewriteWorkspaceIndexBranding(
      '<html><head><title>DeepSeek Harness</title><link rel="icon" href="/deepseek.svg"></head></html>',
    );
    expect(branded).toContain("Univer Workspace Agent");
    expect(branded).toContain('id="uwh-workspace-favicon"');
    expect(JSON.parse(WORKSPACE_MANIFEST_JSON)).toMatchObject({ name: "Univer Workspace Agent" });
  });
});
