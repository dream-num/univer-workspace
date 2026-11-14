import { expect, it } from "vitest";
import { readDebugMode } from "./debug-mode";

it.each([[null, false], ["1", true], ["true", false], ["0", false]])("reads %s as %s", (value, expected) => {
  expect(readDebugMode(() => value)).toBe(expected);
});
it("defaults off when localStorage throws", () => {
  expect(readDebugMode(() => { throw new Error("Storage unavailable"); })).toBe(false);
});
