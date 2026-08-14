import { describe, expect, it } from "vitest";
import { UNIVER_LICENSE } from "../../web/src/features/editor/license.js";
import { resolveUniverLicense } from "../../web/src/features/editor/univer-license.js";

describe("Workspace Univer license", () => {
  it("uses the Univer CLI default when no override is configured", () => {
    expect(resolveUniverLicense(undefined)).toBe(UNIVER_LICENSE);
    expect(UNIVER_LICENSE).toMatch(/^2088168239728517120-/);
  });

  it("uses a configured browser license first", () => {
    expect(resolveUniverLicense(" configured-license ")).toBe(
      "configured-license"
    );
  });
});
