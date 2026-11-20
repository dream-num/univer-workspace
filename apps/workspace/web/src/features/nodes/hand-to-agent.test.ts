// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LanguageProvider } from "../../shared/i18n";
import { sessionQueryKey } from "../auth";
import { HandToAgentDialog, handToAgentPrompt } from "./hand-to-agent";

const mocks = vi.hoisted(() => ({ toast: { success: vi.fn(), error: vi.fn() }, writeText: vi.fn() }));
vi.mock("sonner", async (importOriginal) => ({ ...(await importOriginal<object>()), toast: mocks.toast }));

const origin = "https://workspace.example";

describe("handToAgentPrompt", () => {
  const link = "https://workspace.example/nodes/sheet-node-1";
  const commands = (prompt: string) => prompt.split("\n").filter((line) => /^(npm|uvw) /.test(line));

  it("reads through MCP with no install, and says what to do when the server hides read", () => {
    const prompt = handToAgentPrompt(origin, "sheet-node-1", "read", "mcp");
    expect(prompt.startsWith(`Read this Univer Workspace file, then do what I ask: ${link}`)).toBe(true);
    expect(prompt).toContain(`MCP server ${origin}/mcp`);
    expect(prompt).toContain("Call `read` with the link as `unit`, `trunk: true` and the range A1:J50");
    expect(prompt).toContain("call `inspect` with the link as `unit`, `trunk: true` and `target` set to `document` or `presentation`");
    expect(commands(prompt)).toEqual([]);
  });

  it("falls back to a copy the person edits in the browser before the command line when the server hides read", () => {
    const prompt = handToAgentPrompt(origin, "sheet-node-1", "read", "mcp");
    const order = [
      "If you have no `read` or `inspect` tool, this server does not let you read file contents. Tell me so, then make me a copy",
      "`unit_create`",
      "the link as `from`",
      "`pr_merge`",
      "give me the claim link",
      "Tell me to open the claim link first: the copy is mine to edit once I claim it there. Until then, its link may open read-only or not at all.",
      `give me the copy's link too: ${origin}/nodes/<nodeId>, with the \`nodeId\` that \`unit_create\` returned`,
      "tell me to use the Command line (uvw) option of Hand to my agent",
    ].map((step) => prompt.indexOf(step));
    expect(order.every((at, index) => at > 0 && (index === 0 || at > order[index - 1]!))).toBe(true);
  });

  it("copies through MCP with unit_create from, which needs no read", () => {
    const prompt = handToAgentPrompt(origin, "sheet-node-1", "copy", "mcp");
    expect(prompt.startsWith(`Make me a copy of this Univer Workspace file that I can edit: ${link}`)).toBe(true);
    const order = ["`repo_list`", "`pr_create`", "`unit_create`", "the link as `from`", "`pr_ready`", "`pr_merge`", "`claim`"].map((step) => prompt.indexOf(step));
    expect(order.every((at, index) => at > 0 && (index === 0 || at > order[index - 1]!))).toBe(true);
    expect(prompt).toContain("You do not need `read` for this.");
    expect(prompt).toContain("If you have no `pr_merge`, give me the pull request link to merge.");
    const links = ["give me the claim link", "Tell me to open the claim link first", `give me the copy's link too: ${origin}/nodes/<nodeId>`]
      .map((step) => prompt.indexOf(step));
    expect(links.every((at, index) => at > 0 && (index === 0 || at > links[index - 1]!))).toBe(true);
    expect(commands(prompt)).toEqual([]);
  });

  it("keeps the command line prompts word for word", () => {
    expect(handToAgentPrompt(origin, "sheet-node-1", "read", "cli")).toBe(`Read this Univer Workspace file, then do what I ask: ${link}

Use the uvw CLI:
npm install --global univer-workspace-cli@latest
uvw config set workspace.origin ${origin}
uvw auth guest
uvw read A1:J50 --unit ${link} --trunk

That reads a Sheet. For a Doc or a Slide, run one of these instead:
uvw inspect document --unit ${link} --trunk
uvw inspect presentation --unit ${link} --trunk

With MCP, you can instead connect to ${origin}/mcp and call \`read\` (\`inspect\` for a Doc or Slide) with the link as \`unit\` and \`trunk: true\`. If it has no \`read\` tool, use the CLI.`);
    expect(handToAgentPrompt(origin, "sheet-node-1", "copy", "cli")).toBe(`Make me a copy of this Univer Workspace file that I can edit: ${link}

Use the uvw CLI:
npm install --global univer-workspace-cli@latest
uvw config set workspace.origin ${origin}
uvw auth guest
uvw pr create -R <repo> -t "My copy" --json
uvw unit create --worktree <id> --space <repo> --type sheet --name "My copy" --from ${link} --json
uvw pr ready <id> --json
uvw pr merge <id> --json
uvw claim

<repo> is the Personal Space repository that auth guest prints, and <id> is the id that pr create returns. That copies a Sheet. For a Doc or a Slide, use --type doc or --type slide. Then give me the claim link. Tell me to open the claim link first: the copy is mine to edit once I claim it there. Until then, its link may open read-only or not at all.
Then give me the copy's link too: ${origin}/nodes/<nodeId>, with the nodeId that unit create returns. I open it to edit the copy in the browser.

With MCP, you can instead connect to ${origin}/mcp and call \`pr_create\`, \`unit_create\` with the link as \`from\`, \`pr_ready\`, \`pr_merge\` and \`claim\`. If \`unit_create\` has no \`from\`, use the CLI.`);
  });

  it("varies only by the file's link, so nothing from the file reaches the agent", () => {
    for (const task of ["read", "copy"] as const) {
      for (const way of ["mcp", "cli"] as const) {
        const shown = handToAgentPrompt(origin, "sheet-node-1", task, way);
        expect(handToAgentPrompt(origin, "doc-node-2", task, way)).toBe(shown.replaceAll("sheet-node-1", "doc-node-2"));
        expect(handToAgentPrompt("https://workspace.example", "sheet-node-1", task, way))
          .toBe(shown.replaceAll(origin, "https://workspace.example"));
      }
    }
  });
});

describe("HandToAgentDialog", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("navigator", { clipboard: { writeText: mocks.writeText } });
    window.localStorage.setItem("univer-workspace-language", "en-US");
    vi.clearAllMocks();
    mocks.writeText.mockResolvedValue(undefined);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  function control(name: string): HTMLButtonElement {
    const found = [...document.querySelectorAll("button")].find((button) => (button.getAttribute("aria-label") ?? button.textContent) === name);
    if (!found) throw new Error(`No control named ${name}`);
    return found;
  }

  async function open(signedIn = false) {
    const client = new QueryClient();
    client.setQueryData(sessionQueryKey, signedIn ? { authenticated: true, user: { id: "reader" } } : { authenticated: false });
    await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(LanguageProvider, null, createElement(HandToAgentDialog, { nodeId: "sheet-node-1", open: true, onOpenChange: vi.fn() })))));
  }

  it("opens on MCP, recommended, and copies its server URL and prompt", async () => {
    await open();
    expect(control("MCP (recommended)").getAttribute("aria-pressed")).toBe("true");
    expect(control("Command line (uvw)").getAttribute("aria-pressed")).toBe("false");
    expect(document.body.textContent).toContain("Continue as a guest agent");

    await act(async () => control("Copy MCP server URL").click());
    expect(mocks.writeText).toHaveBeenLastCalledWith(`${window.location.origin}/mcp`);
    expect(mocks.toast.success).toHaveBeenLastCalledWith("MCP server URL copied.");

    await act(async () => control("Copy prompt").click());
    expect(mocks.writeText).toHaveBeenLastCalledWith(handToAgentPrompt(window.location.origin, "sheet-node-1", "read", "mcp"));
    expect(mocks.toast.success).toHaveBeenLastCalledWith("Prompt copied. Paste it into your agent.");
  });

  it("offers the guest agent sign-in only to a reader who is not signed in", async () => {
    await open(true);
    expect(control("MCP (recommended)").getAttribute("aria-pressed")).toBe("true");
    expect(document.body.textContent).not.toContain("Continue as a guest agent");
  });

  it("copies the CLI prompt once the reader chooses the command line", async () => {
    await open();
    await act(async () => control("Command line (uvw)").click());
    expect(control("Command line (uvw)").getAttribute("aria-pressed")).toBe("true");
    expect(() => control("Copy MCP server URL")).toThrow();
    const prompt = handToAgentPrompt(window.location.origin, "sheet-node-1", "read", "cli");
    expect(document.querySelector("pre")?.textContent).toBe(prompt);
    await act(async () => control("Copy prompt").click());
    expect(mocks.writeText).toHaveBeenLastCalledWith(prompt);
  });

  it("says so when the clipboard refuses", async () => {
    mocks.writeText.mockRejectedValue(new Error("denied"));
    await open();
    await act(async () => control("Copy prompt").click());
    expect(mocks.toast.error).toHaveBeenCalledWith("Unable to copy the prompt.");
    expect(mocks.toast.success).not.toHaveBeenCalled();
  });
});
