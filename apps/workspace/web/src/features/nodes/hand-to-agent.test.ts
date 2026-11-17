// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LanguageProvider } from "../../shared/i18n";
import { HandToAgentButton, handToAgentPrompt } from "./hand-to-agent";

const mocks = vi.hoisted(() => ({ toast: { success: vi.fn(), error: vi.fn() }, writeText: vi.fn() }));
vi.mock("sonner", async (importOriginal) => ({ ...(await importOriginal<object>()), toast: mocks.toast }));

const origin = "https://space.univer.ai";

describe("handToAgentPrompt", () => {
  const prompt = handToAgentPrompt(origin, "sheet-node-1");

  it("fills in the share link, the MCP URL and the CLI fallback for this instance", () => {
    expect(prompt).toContain("Read this Univer Workspace file, then do what I ask: https://space.univer.ai/nodes/sheet-node-1\n");
    expect(prompt).toContain("connect to https://space.univer.ai/mcp, then call `read` with the link as `unit`, `trunk: true`");
    expect(prompt).toContain("npm install --global univer-workspace-cli@latest\nuvw config set workspace.origin https://space.univer.ai\nuvw auth guest\n");
    expect(prompt).toContain("uvw read A1:J50 --unit https://space.univer.ai/nodes/sheet-node-1 --trunk");
    expect(prompt.length).toBeLessThan(600);
  });

  it("varies only by the file's link, so nothing from the file reaches the agent", () => {
    expect(handToAgentPrompt(origin, "doc-node-2")).toBe(prompt.replaceAll("sheet-node-1", "doc-node-2"));
    expect(handToAgentPrompt("https://workspace.example", "sheet-node-1"))
      .toBe(prompt.replaceAll(origin, "https://workspace.example"));
  });
});

describe("HandToAgentButton", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("navigator", { clipboard: { writeText: mocks.writeText } });
    window.localStorage.setItem("univer-workspace-language", "en-US");
    vi.clearAllMocks();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  async function click() {
    await act(async () => root.render(createElement(LanguageProvider, null, createElement(HandToAgentButton, { nodeId: "sheet-node-1" }))));
    const button = container.querySelector("button");
    expect(button?.textContent).toBe("Hand to my agent");
    await act(async () => button?.click());
  }

  it("copies the prompt for this page's origin and confirms", async () => {
    mocks.writeText.mockResolvedValue(undefined);
    await click();
    expect(mocks.writeText).toHaveBeenCalledWith(handToAgentPrompt(window.location.origin, "sheet-node-1"));
    expect(mocks.toast.success).toHaveBeenCalledWith("Prompt copied. Paste it into your agent.");
  });

  it("says so when the clipboard refuses", async () => {
    mocks.writeText.mockRejectedValue(new Error("denied"));
    await click();
    expect(mocks.toast.error).toHaveBeenCalledWith("Unable to copy the prompt.");
    expect(mocks.toast.success).not.toHaveBeenCalled();
  });
});
