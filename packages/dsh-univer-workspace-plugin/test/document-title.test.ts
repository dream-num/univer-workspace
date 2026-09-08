import { describe, expect, it } from "vitest";
import { formatAgentDocumentTitle, AGENT_PRODUCT_TITLE } from "../src/client/document-title.ts";

describe("Workspace Agent browser title", () => {
  it("uses the Workspace product title when no session is selected", () => {
    expect(formatAgentDocumentTitle(undefined)).toBe("Univer Workspace Agent");
    expect(AGENT_PRODUCT_TITLE).toBe("Univer Workspace Agent");
  });

  it("keeps the native session title separator and replaces its suffix", () => {
    expect(formatAgentDocumentTitle("Quarterly plan")).toBe(
      "Quarterly plan — Univer Workspace Agent",
    );
  });
});
