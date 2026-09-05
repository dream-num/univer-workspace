import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { en, zh, type UniverLocaleKey } from "../src/client/locales.ts";

const sidebarSource = await readFile(
  new URL("../src/client/WorkspaceSidebarRoot.tsx", import.meta.url),
  "utf8",
);
const clientSource = await readFile(new URL("../src/client/index.tsx", import.meta.url), "utf8");

describe("Workspace sidebar locale contract", () => {
  it("binds the custom sidebar root to the plugin-owned locale namespace", () => {
    expect(clientSource).toMatch(
      /name:\s*"sidebar",[\s\S]{0,120}locale:\s*UNIVER_LOCALE_NAMESPACE/,
    );
  });

  it("defines every static sidebar translation key in both dictionaries", () => {
    const keys = [...sidebarSource.matchAll(/props\.t\("([^"]+)"\)/g)].map(
      (match) => match[1] as UniverLocaleKey,
    );

    expect([...new Set(keys)].sort()).toEqual([
      "session.new",
      "session.new.label",
      "toggle.collapse",
      "toggle.open",
    ]);
    for (const key of keys) {
      expect(zh[key]).toBeTruthy();
      expect(en[key]).toBeTruthy();
      expect(zh[key]).not.toBe(key);
      expect(en[key]).not.toBe(key);
    }
  });
});
