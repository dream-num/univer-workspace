import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("skin client style pipeline", () => {
  it("keeps the client entry in JSX with a static CSS import", async () => {
    const entry = await readFile(new URL("../src/client/index.tsx", import.meta.url), "utf8");
    expect(entry).toContain('import "./skin.css"');
    expect(entry).not.toContain('document.createElement("style")');
    expect(entry).not.toContain("textContent = skinCss");
  });

  it("builds the browser entry with Vite instead of a CSS text loader", async () => {
    const buildScript = await readFile(new URL("../scripts/build.mjs", import.meta.url), "utf8");
    expect(buildScript).toContain('import { build as viteBuild } from "vite"');
    expect(buildScript).toContain('assetInfo.name?.endsWith(".css") ? "client.css"');
    expect(buildScript).not.toContain('loader: { ".css": "text" }');
  });
});
