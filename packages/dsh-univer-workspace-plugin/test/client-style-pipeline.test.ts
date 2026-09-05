import { access, readFile, readdir } from "node:fs/promises";
import { extname, join } from "node:path";
import { describe, expect, it } from "vitest";

const clientRoot = new URL("../src/client/", import.meta.url);

async function collectClientSources(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        return collectClientSources(path);
      }

      return [".ts", ".tsx"].includes(extname(entry.name)) ? [path] : [];
    }),
  );

  return nested.flat();
}

describe("client style pipeline", () => {
  it("loads client styles through the static Vite entry", async () => {
    const clientEntry = await readFile(new URL("../src/client/index.tsx", import.meta.url), "utf8");
    const styleEntry = await readFile(new URL("../src/client/index.css", import.meta.url), "utf8");

    expect(clientEntry).toContain('import "./index.css";');
    expect(styleEntry).not.toContain("harness-ui.scss");
    await expect(
      access(new URL("../src/client/SpaceDirectoryFlow.module.scss", import.meta.url)),
    ).resolves.toBeUndefined();
    await expect(
      access(new URL("../src/client/WorkspaceSwitchButton.module.scss", import.meta.url)),
    ).resolves.toBeUndefined();
    await expect(
      access(new URL("../src/client/TemplateForkAction.module.scss", import.meta.url)),
    ).resolves.toBeUndefined();
    await expect(
      access(new URL("../src/client/components/review-panel.module.scss", import.meta.url)),
    ).resolves.toBeUndefined();
    await expect(
      access(new URL("../src/client/styles/viewer.css", import.meta.url)),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not restore the retired runtime style injectors", async () => {
    await expect(access(new URL("../src/client/styles.ts", import.meta.url))).rejects.toMatchObject(
      {
        code: "ENOENT",
      },
    );
    await expect(
      access(new URL("../src/client/viewer-css.ts", import.meta.url)),
    ).rejects.toMatchObject({ code: "ENOENT" });

    const sources = await collectClientSources(clientRoot.pathname);
    for (const path of sources) {
      const source = await readFile(path, "utf8");
      expect(source, path).not.toMatch(/document\.createElement\(\s*["']style["']/);
      expect(source, path).not.toMatch(/new\s+CSSStyleSheet\s*\(/);
    }
  });

  it("registers both the Turn-tail review card and the session task dock", async () => {
    const clientEntry = await readFile(new URL("../src/client/index.tsx", import.meta.url), "utf8");

    expect(clientEntry).toContain('import { PreviewCard } from "./components/preview-card.tsx";');
    expect(clientEntry).toContain('ctx.slots.inject("conversation.chat.turnTail"');
    expect(clientEntry).toContain('ctx.slots.inject("conversation.input.dock"');
  });
});
