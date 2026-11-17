// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { UiModeProvider, useUiMode } from "./ui-mode";

const modeKey = "univer-workspace-layout-theme";
const completedKey = "univer-workspace-view-onboarding-complete";
const modes = ["wiki", "repository"] as const;
let root: Root;
let container: HTMLDivElement;

function Choice() {
  const { mode, needsOnboarding, setMode } = useUiMode();
  return needsOnboarding
    ? createElement("button", { onClick: () => setMode(mode) }, mode)
    : createElement("span", null, mode);
}

async function load(key: number) {
  await act(async () => root.render(createElement(UiModeProvider, {
    key, modes, fallback: "repository",
  }, createElement(Choice))));
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.localStorage.clear();
  container = document.createElement("div");
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

it("keeps first visits pending across reloads until the default is explicitly confirmed", async () => {
  await load(0);
  expect(window.localStorage.getItem(modeKey)).toBeNull();
  await load(1);
  const confirm = container.querySelector("button");
  expect(confirm?.textContent).toBe("repository");
  await act(async () => confirm!.click());
  expect(window.localStorage.getItem(completedKey)).toBe("true");
  expect(window.localStorage.getItem(modeKey)).toBe("repository");
  await load(2);
  expect(container.querySelector("button")).toBeNull();
});

it.each(modes)("preserves a returning browser's %s view without prompting", async (mode) => {
  window.localStorage.setItem(modeKey, mode);
  await load(0);
  expect(container.querySelector("span")?.textContent).toBe(mode);
});
