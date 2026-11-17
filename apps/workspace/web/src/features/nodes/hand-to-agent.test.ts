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

  it("leads with the complete CLI path for this instance, then offers MCP", () => {
    const link = "https://space.univer.ai/nodes/sheet-node-1";
    const commands = prompt.split("\n").filter((line) => /^(npm|uvw) /.test(line));
    expect(commands).toEqual([
      "npm install --global univer-workspace-cli@latest",
      `uvw config set workspace.origin ${origin}`,
      "uvw auth guest",
      `uvw read A1:J50 --unit ${link} --trunk`,
      `uvw inspect document --unit ${link} --trunk`,
      `uvw inspect presentation --unit ${link} --trunk`,
    ]);
    expect(prompt.indexOf(commands.at(-1)!)).toBeLessThan(prompt.indexOf(`${origin}/mcp`));
    expect(prompt).toContain("no `read` tool, use the CLI");
  });

  it("varies only by the file's link, so nothing from the file reaches the agent", () => {
    for (const task of ["read", "copy"] as const) {
      const shown = handToAgentPrompt(origin, "sheet-node-1", task);
      expect(handToAgentPrompt(origin, "doc-node-2", task)).toBe(shown.replaceAll("sheet-node-1", "doc-node-2"));
      expect(handToAgentPrompt("https://workspace.example", "sheet-node-1", task))
        .toBe(shown.replaceAll(origin, "https://workspace.example"));
    }
  });

  it("asks for a copy with the same CLI setup, copying through unit create --from", () => {
    const link = "https://space.univer.ai/nodes/sheet-node-1";
    const copy = handToAgentPrompt(origin, "sheet-node-1", "copy");
    expect(copy.split("\n").filter((line) => /^(npm|uvw) /.test(line))).toEqual([
      "npm install --global univer-workspace-cli@latest",
      `uvw config set workspace.origin ${origin}`,
      "uvw auth guest",
      'uvw pr create -R <repo> -t "My copy" --json',
      `uvw unit create --worktree <id> --space <repo> --type sheet --name "My copy" --from ${link} --json`,
      "uvw pr ready <id> --json",
      "uvw pr merge <id> --json",
      "uvw claim",
    ]);
    expect(copy.indexOf("uvw claim")).toBeLessThan(copy.indexOf(`${origin}/mcp`));
    expect(copy).toContain("`unit_create` with the link as `from`");
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
