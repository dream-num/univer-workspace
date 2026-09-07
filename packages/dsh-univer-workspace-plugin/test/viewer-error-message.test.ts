import { describe, expect, it } from "vitest";
import { viewerErrorMessage } from "../src/client/viewer/error-message.ts";

describe("viewer error messages", () => {
  it("extracts a structured response message without rendering the request", () => {
    expect(viewerErrorMessage({ error: { code: "DENIED", message: "Document access was denied." }, request: { token: "private" } }))
      .toBe("Document access was denied.");
    expect(viewerErrorMessage(new Error("Snapshot unavailable"))).toBe("Snapshot unavailable");
  });

  it("replaces opaque object coercion and handles cyclic or empty errors", () => {
    const fallback = "Unable to load this document. Try again or reconnect to Workspace.";
    expect(viewerErrorMessage(new Error("[object Object]"))).toBe(fallback);
    expect(viewerErrorMessage({})).toBe(fallback);
    const cycle: { cause?: unknown } = {};
    cycle.cause = cycle;
    expect(viewerErrorMessage(cycle)).toBe(fallback);
    expect(viewerErrorMessage({ status: 409, request: { token: "private" } }))
      .toBe("Document request failed (HTTP 409). Try again or reconnect to Workspace.");
  });
});
