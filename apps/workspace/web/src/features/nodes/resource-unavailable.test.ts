import { describe, expect, it } from "vitest";
import { ApiError } from "../../shared/api/errors.js";
import { isResourceUnavailableError } from "./resource-unavailable.js";

describe("isResourceUnavailableError", () => {
  it("treats a concealed not-found response as unavailable", () => {
    expect(
      isResourceUnavailableError(
        new ApiError("The resource was not found.", "NOT_FOUND")
      )
    ).toBe(true);
  });

  it("leaves unrelated failures to the standard error boundary", () => {
    expect(
      isResourceUnavailableError(
        new ApiError("The request failed.", "REQUEST_FAILED")
      )
    ).toBe(false);
    expect(isResourceUnavailableError(new Error("Unexpected failure"))).toBe(
      false
    );
  });
});
