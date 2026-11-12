// @vitest-environment jsdom
import { $getRoot, KEY_DOWN_COMMAND, KEY_ENTER_COMMAND } from "lexical";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LanguageProvider } from "../../../shared/i18n";
import { session } from "../test-helpers";
import { ComposerEditor, type ComposerEditorHandle } from "./composer-editor";
import { AgentSessionPage } from "./session-page";

const runner = vi.hoisted(() => ({ send: vi.fn(), stop: vi.fn(), isRunningHere: () => true }));
const client = { prewarm: async () => {}, runner: async () => runner };
let current = session();
vi.mock("./client", () => ({ useAgentClient: () => client }));
vi.mock("./sessions", () => ({
  useAgentSessions: () => ({ data: [current] }), SessionStatus: () => null,
  SessionScope: () => null, SessionModel: () => null, SessionPullRequest: () => null,
}));
vi.mock("./composer-settings", () => ({
  useAgentModel: () => ({ selected: { provider: { id: "provider", kind: "openai" }, modelId: "model" }, setSettings: vi.fn() }),
  AgentModelControls: () => null, AgentRepositorySelect: () => null,
}));
vi.mock("./references", () => ({ AgentReferencePill: () => null, referenceTrigger: () => null }));
vi.mock("../../html-views/drafts/draft-review", () => ({ HtmlViewDraftReview: () => null }));
vi.mock("../../issues/issue-markdown", () => ({ IssueMarkdown: ({ text }: { text: string }) => createElement("p", null, text) }));

let container: HTMLDivElement;
let root: Root;
let resize: () => void;
let contentHeight: number;
const disconnect = vi.fn();
const observe = vi.fn();
beforeEach(() => {
  vi.clearAllMocks(); current = session();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: typeof resize) { resize = callback; }
    observe = observe; disconnect = disconnect;
  });
  window.localStorage.setItem("univer-workspace-language", "en-US");
  container = document.createElement("div"); container.className = "rd-viewport"; document.body.append(container);
  contentHeight = 3247;
  let position = 76;
  Object.defineProperties(container, {
    scrollHeight: { get: () => contentHeight }, clientHeight: { value: 800 },
    scrollTop: { get: () => position, set: (value: number) => { position = Math.max(0, Math.min(value, contentHeight - container.clientHeight)); } },
  });
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove(); vi.unstubAllGlobals();
});
async function renderSession() {
  await act(async () => root.render(createElement(LanguageProvider, null, createElement(AgentSessionPage, {
    sessionId: current.id, renderPage: (content) => content,
  }))));
}
function textarea() {
  const input = container.querySelector("textarea");
  if (!input) throw new Error("Missing follow-up input");
  return input;
}
function actionButton() {
  const button = container.querySelector<HTMLButtonElement>(".agent-send");
  if (!button) throw new Error("Missing chat action");
  return button;
}
async function type(value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(textarea(), value);
    textarea().dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function key(input: HTMLElement, init: KeyboardEventInit) {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  await act(async () => { input.dispatchEvent(event); });
  return event;
}

it("opens at the bottom and follows late-rendered content until a user scrolls away, then resumes at the bottom", async () => {
  current = session({ scope: { kind: "repository", spaceId: "repo", baseWorktreeId: null } });
  await renderSession();
  expect(container.scrollTop).toBe(2447);
  expect(observe).toHaveBeenCalledExactlyOnceWith(container.querySelector(".agent-conversation"));
  contentHeight = 4000;
  resize(); expect(container.scrollTop).toBe(3200);
  contentHeight = 4500;
  resize(); expect(container.scrollTop).toBe(3700);
  container.scrollTop = 1000; container.dispatchEvent(new Event("scroll"));
  contentHeight = 5000;
  resize(); expect(container.scrollTop).toBe(1000);
  container.scrollTop = contentHeight - container.clientHeight - 48; container.dispatchEvent(new Event("scroll"));
  resize(); expect(container.scrollTop).toBe(4152);
  container.scrollTop += 1; container.dispatchEvent(new Event("scroll"));
  contentHeight = 5500;
  resize(); expect(container.scrollTop).toBe(4700);
  await act(async () => root.unmount()); expect(disconnect).toHaveBeenCalledOnce();
});

it("leaves scrolling alone when there is no repository viewport", async () => {
  container.className = "";
  await renderSession();
  expect(container.scrollTop).toBe(76);
  expect(observe).not.toHaveBeenCalled();
});

it("offers one Stop action while running empty and Send for a queued follow-up", async () => {
  current = session({ status: "running" }); await renderSession();
  expect(container.querySelectorAll(".agent-composer-controls button")).toHaveLength(1);
  expect(actionButton().getAttribute("aria-label")).toBe("Stop");
  expect(actionButton().type).toBe("button");
  await act(async () => actionButton().click()); expect(runner.stop).toHaveBeenCalledWith(current.id);
  await type("Queued message");
  expect(actionButton().getAttribute("aria-label")).toBe("Send");
  expect(actionButton().type).toBe("submit");
  await act(async () => actionButton().click());
  expect(runner.send).toHaveBeenCalledWith(current.id, "Queued message", current);
  expect(textarea().value).toBe("");
  expect(actionButton().getAttribute("aria-label")).toBe("Stop");
});

it("keeps Continue for resumable sessions and puts errors with the follow-up in the dock", async () => {
  current = session({ status: "failed", error: "Failed run" }); await renderSession();
  expect(container.querySelector(".agent-session-dock [role=alert]")?.textContent).toBe("Failed run");
  expect(container.querySelector(".agent-session-dock textarea")?.getAttribute("rows")).toBe("1");
  expect(container.querySelector(".agent-followup .agent-note")).toBeNull();
  const resume = [...container.querySelectorAll("button")].find((button) => button.textContent === "Continue");
  if (!resume) throw new Error("Missing Continue action");
  await act(async () => resume.click());
  expect(runner.send).toHaveBeenCalledWith(current.id, "Continue", expect.anything());
});

it("sends follow-ups with Enter and Ctrl/Cmd+Enter, leaves shifted Enter native and respects IME", async () => {
  await renderSession();
  expect(actionButton().getAttribute("aria-keyshortcuts")).toBe("Enter");
  for (const modifiers of [{}, { ctrlKey: true }, { metaKey: true }]) {
    await type("Hello"); await key(textarea(), { key: "Enter", ...modifiers });
    expect(runner.send).toHaveBeenLastCalledWith(current.id, "Hello", expect.anything());
    expect(textarea().value).toBe("");
  }
  runner.send.mockClear(); await type("Hello");
  expect((await key(textarea(), { key: "Enter", shiftKey: true })).defaultPrevented).toBe(false);
  for (const modifiers of [{}, { ctrlKey: true }, { metaKey: true }]) await key(textarea(), { key: "Enter", isComposing: true, ...modifiers });
  expect(runner.send).not.toHaveBeenCalled();
  textarea().setSelectionRange(1, 4);
  await key(textarea(), { key: "j", ctrlKey: true });
  expect(textarea().value).toBe("H\no");
  expect(textarea().selectionStart).toBe(2); expect(textarea().selectionEnd).toBe(2);
  await key(textarea(), { key: "Enter" });
  expect(runner.send).toHaveBeenLastCalledWith(current.id, "H\no", expect.anything());
});

it("uses chat keys in the real Lexical composer, including line breaks and IME protection", async () => {
  const handle: { current: ComposerEditorHandle | null } = { current: null };
  const onSend = vi.fn();
  await act(async () => root.render(createElement(ComposerEditor, {
    handle, label: "Prompt", busy: false, starter: { text: "Hello" }, onSend,
    onChange: vi.fn(), onTrigger: vi.fn(), onFocus: vi.fn(),
  })));
  if (!handle.current) throw new Error("Missing editor handle");
  const editor = handle.current.editor;
  for (const modifiers of [{}, { ctrlKey: true }, { metaKey: true }]) {
    await act(async () => { editor.dispatchCommand(KEY_ENTER_COMMAND, new KeyboardEvent("keydown", { key: "Enter", ...modifiers })); });
  }
  expect(onSend).toHaveBeenCalledTimes(3);
  await act(async () => { editor.dispatchCommand(KEY_ENTER_COMMAND, new KeyboardEvent("keydown", { key: "Enter", isComposing: true })); });
  const input = editor.getRootElement();
  if (!input) throw new Error("Missing editor input");
  await act(async () => { input.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true })); });
  expect(editor.isComposing()).toBe(true);
  await act(async () => { editor.dispatchCommand(KEY_ENTER_COMMAND, new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true })); });
  await act(async () => { input.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "" })); });
  expect(onSend).toHaveBeenCalledTimes(3);
  for (const [command, init] of [
    [KEY_ENTER_COMMAND, { key: "Enter", shiftKey: true }], [KEY_DOWN_COMMAND, { key: "j", ctrlKey: true }],
  ] as const) {
    const before = editor.getEditorState().read(() => $getRoot().getTextContent());
    await act(async () => { editor.update(() => $getRoot().selectEnd()); });
    await act(async () => { editor.dispatchCommand(command, new KeyboardEvent("keydown", init)); });
    expect(editor.getEditorState().read(() => $getRoot().getTextContent())).toBe(`${before}\n`);
  }
  expect(onSend).toHaveBeenCalledTimes(3);
});
