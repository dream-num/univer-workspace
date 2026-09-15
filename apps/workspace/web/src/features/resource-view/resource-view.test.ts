import { describe, expect, it } from "vitest";
import { defaultSharedView, isResourceViewChange, parseResourceView, resourceShareUrl } from "./resource-view";
import { validLoginReturnTo } from "../auth/auth.queries";

describe("resource presentation", () => {
  it("accepts only the explicit immersive value", () => {
    for (const value of [undefined, true, ["immersive"], "fullscreen", "standard"]) {
      expect(parseResourceView(value)).toBeUndefined();
    }
    expect(parseResourceView("immersive")).toBe("immersive");
  });
  it("bypasses saving only when toggling the same resource presentation", () => {
    const standard = { pathname: "/nodes/a", search: { unit: "unit-a" } };
    const immersive = { ...standard, search: { ...standard.search, view: "immersive" } };
    expect(isResourceViewChange(standard, immersive)).toBe(true);
    expect(isResourceViewChange(immersive, standard)).toBe(true);
    expect(isResourceViewChange(standard, standard)).toBe(false);
    expect(isResourceViewChange(standard, { ...immersive, pathname: "/nodes/b" })).toBe(false);
    expect(isResourceViewChange(standard, { ...immersive, search: { view: "immersive", unit: "unit-b" } })).toBe(false);
    expect(isResourceViewChange(standard, { ...immersive, search: { view: "hidden" } })).toBe(false);
    expect(isResourceViewChange(standard, { ...immersive, search: { ...immersive.search, other: 1 } })).toBe(false);
  });
  it("defaults HTML shares using the current node name", () => {
    expect(defaultSharedView({ name: "Dashboard.UNIVER.HTML", resource: { kind: "blob" } })).toBe("immersive");
    expect(defaultSharedView({ name: "page.html", resource: { kind: "blob" } })).toBe("standard");
    expect(defaultSharedView({ name: "Dashboard.univer.html", resource: { kind: "univer" } })).toBe("standard");
    expect(defaultSharedView({ name: "Dashboard.univer.html", resource: null })).toBe("standard");
    expect(defaultSharedView({ name: "Renamed dashboard", resource: { kind: "blob" } })).toBe("standard");
    expect(defaultSharedView(null)).toBe("standard");
    expect(resourceShareUrl("https://workspace.example", "a/b", "immersive")).toBe("https://workspace.example/nodes/a%2Fb?view=immersive");
    expect(resourceShareUrl("https://workspace.example", "a", "standard")).toBe("https://workspace.example/nodes/a");
  });
  it("preserves immersive deep links across login", () => {
    expect(validLoginReturnTo("/nodes/a?view=immersive#section")).toBe("/nodes/a?view=immersive#section");
  });
});
