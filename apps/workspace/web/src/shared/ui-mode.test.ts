import { describe, expect, it } from "vitest";
import { parseUiMode } from "./ui-mode";

const modes = ["wiki", "repository"] as const;

describe("parseUiMode", () => {
  it.each(modes)("keeps the known mode %s", (mode) => {
    expect(parseUiMode(mode, modes, "wiki")).toBe(mode);
  });

  it.each(["unknown", "", "Repository", " repository ", null, undefined, 0, false, {}])(
    "falls back to wiki for %j",
    (raw) => {
      expect(parseUiMode(raw, modes, "wiki")).toBe("wiki");
    },
  );

  it("uses the supplied mode set and fallback", () => {
    const known = ["wiki", "repository", "drive"] as const;
    expect(parseUiMode("drive", known, "wiki")).toBe("drive");
    expect(parseUiMode("unknown", known, "repository")).toBe("repository");
  });
});
