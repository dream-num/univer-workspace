import { describe, expect, it } from "vitest";
import config from "../../vite.config.ts";

describe("Workspace browser Vite composition", () => {
  it("deduplicates React for source-exported private workspace packages", () => {
    expect(config.resolve?.dedupe).toEqual(expect.arrayContaining(["react", "react-dom"]));
  });
});
