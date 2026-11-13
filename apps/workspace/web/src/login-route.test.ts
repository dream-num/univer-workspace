import { describe, expect, it } from "vitest";
import { Route } from "./routes/login";

const validateSearch = Route.options.validateSearch;
if (typeof validateSearch !== "function") throw new Error("Login search parser is missing");

describe("login search", () => {
  it("keeps register mode and the immersive return URL", () => {
    expect(validateSearch({ mode: "register", returnTo: "/nodes/one?view=immersive#chart" })).toEqual({
      mode: "register",
      oauthError: undefined,
      returnTo: "/nodes/one?view=immersive#chart",
    });
  });

  it.each([undefined, "login", "REGISTER", "", 1, ["register"], { mode: "register" }])(
    "drops unrecognized mode %j", (mode) => {
      expect(validateSearch({ mode })).not.toHaveProperty("mode");
    },
  );

  it("retains OAuth errors and rejects unsafe return URLs", () => {
    expect(validateSearch({ mode: "register", oauthError: "Denied", returnTo: "//example.com" })).toEqual({
      mode: "register", oauthError: "Denied", returnTo: undefined,
    });
  });
});
