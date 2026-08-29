import { describe, expect, it } from "vitest";
import { formatHarnessDocumentTitle, HARNESS_PRODUCT_TITLE } from "../src/client/document-title.ts";

describe("Workspace Harness browser title", () => {
  it("uses the Workspace product title when no session is selected", () => {
    expect(formatHarnessDocumentTitle(undefined)).toBe("Univer Workspace Harness");
    expect(HARNESS_PRODUCT_TITLE).toBe("Univer Workspace Harness");
  });

  it("keeps the native session title separator and replaces its suffix", () => {
    expect(formatHarnessDocumentTitle("Quarterly plan")).toBe(
      "Quarterly plan — Univer Workspace Harness",
    );
  });
});
