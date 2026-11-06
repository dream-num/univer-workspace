import { describe, expect, it } from "vitest";
import { movePin, togglePin } from "./pin-draft";

describe("sidebar pin draft", () => {
  it("appends new pins, removes selected pins and enforces the server limit", () => {
    const ids = ["b", "a"];
    expect(togglePin(ids, "c", 3)).toEqual(["b", "a", "c"]);
    expect(togglePin(ids, "c", 2)).toEqual(ids);
    expect(togglePin(ids, "a", 2)).toEqual(["b"]);
    expect(togglePin(["a"], "a", 2)).toEqual([]);
    expect(ids).toEqual(["b", "a"]);
  });

  it("moves a pin one position in either direction without changing the input", () => {
    const ids = ["c", "b", "a"];
    expect(movePin(ids, "b", "up")).toEqual(["b", "c", "a"]);
    expect(movePin(ids, "b", "down")).toEqual(["c", "a", "b"]);
    expect(movePin(ids, "c", "up")).toEqual(ids);
    expect(movePin(ids, "a", "down")).toEqual(ids);
    expect(movePin(ids, "missing", "down")).toEqual(ids);
    expect(movePin([], "a", "up")).toEqual([]);
    expect(ids).toEqual(["c", "b", "a"]);
  });
});
