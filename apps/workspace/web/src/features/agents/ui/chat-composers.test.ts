// @vitest-environment jsdom
import { $getRoot, KEY_DOWN_COMMAND, KEY_ENTER_COMMAND } from "lexical";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LanguageProvider } from "../../../shared/i18n";
import { session } from "../test-helpers";
import { ComposerEditor, type ComposerEditorHandle } from "./composer-editor";
import { SkillMenu, useSkillMenu } from "./skill-menu";
import { AgentSessionPage } from "./session-page";

const runner = vi.hoisted(() => ({ skills: vi.fn(), send: vi.fn(), stop: vi.fn(), isRunningHere: () => true }));
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
const scrollIntoView = vi.fn();
beforeEach(() => {
  vi.clearAllMocks(); current = session();
  Object.defineProperty(Element.prototype, "scrollIntoView", { configurable: true, value: scrollIntoView });
  runner.skills.mockResolvedValue({ repository: "loaded", diagnostics: [], skills: [
    { name: "weekly-report", source: "repository", description: "Write a weekly report", argumentHint: "[week]", userInvocable: true, modelInvocable: false },
    { name: "weekly-review", source: "user", description: "Review a week", userInvocable: true, modelInvocable: true },
    { name: "hidden", source: "user", description: "Model only", userInvocable: false, modelInvocable: true },
  ] });
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
    scrollTop: { get: () => position, set: (value: number) => {
      position = Math.max(0, Math.min(value, contentHeight - container.clientHeight));
      container.dispatchEvent(new Event("scroll"));
    } },
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

it("stops following after a small upward scroll within 48px of the bottom while running", async () => {
  current = session({ status: "running" }); await renderSession();
  expect(container.scrollTop).toBe(2447);
  contentHeight = 4000;
  resize(); expect(container.scrollTop).toBe(3200);
  container.scrollTop -= 12;
  contentHeight = 4500;
  resize(); expect(container.scrollTop).toBe(3188);
  container.scrollTop = contentHeight - container.clientHeight;
  contentHeight = 5000;
  resize(); expect(container.scrollTop).toBe(4200);
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
  expect(container.querySelector(".agent-session-dock textarea")?.getAttribute("rows")).toBe("2");
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

it("shows used skills first, expands the remainder and diagnostics, and collapses again", async () => {
  const skills = ["z-personal", "a-repo", "b-repo", "c-personal", "d-repo"].map((name) => ({
    name, source: name.endsWith("repo") ? "repository" as const : "user" as const,
    description: `Description ${name}`, path: `.agents/skills/${name}/SKILL.md`, modelInvocable: true, userInvocable: true,
  }));
  const read = (name: string, isError = false) => ({ type: "dynamic-tool" as const, toolName: "skills_read", toolCallId: name,
    state: "output-available" as const, input: { name }, output: { isError, structuredContent: { content: "Read" } } });
  current = session({ messages: [
    { id: "user", role: "user", parts: [{ type: "text", text: "Skills" }], metadata: { agentSkills: { skills,
      repository: "loaded", diagnostics: [{ source: "repository", path: ".agents/skills/bad/SKILL.md", problem: "invalid-skill", detail: "Missing description" }] } } },
    { id: "assistant", role: "assistant", parts: [read("c-personal"), read("core"), read("a-repo", true), read("z-personal")] },
    { id: "steering", role: "user", parts: [{ type: "text", text: "Continue" }] },
  ] });
  await renderSession();
  const names = () => [...container.querySelectorAll(".agent-skill-name")].map((item) => item.textContent);
  expect(names()).toEqual(["c-personal", "z-personal", "a-repo"]);
  expect(container.querySelectorAll(".agent-skill-used")).toHaveLength(2);
  const rail = container.querySelector(".agent-session-rail")!;
  expect(rail.textContent).toContain("Repository");
  expect(rail.textContent).toContain("Personal");
  expect(rail.querySelector(".agent-skills li")?.getAttribute("title")).toBe("Description c-personal\n.agents/skills/c-personal/SKILL.md");
  const toggle = rail.querySelector<HTMLButtonElement>(".agent-steps-window")!;
  expect(toggle.textContent).toBe("Show 2 more skills");
  expect(rail.textContent).not.toContain("Missing description");
  await act(async () => toggle.click());
  expect(names()).toEqual(["c-personal", "z-personal", "a-repo", "b-repo", "d-repo"]);
  expect(rail.textContent).toContain("Missing description");
  expect(rail.textContent).toContain(".agents/skills/bad/SKILL.md");
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  await act(async () => toggle.click());
  expect(names()).toHaveLength(3);
  expect(rail.textContent).not.toContain("Missing description");
});

it("shows empty and non-member guidance and can expand diagnostics without hidden skills", async () => {
  window.localStorage.setItem("univer-workspace-language", "zh-CN");
  current = session({ messages: [{ id: "user", role: "user", parts: [{ type: "text", text: "Skills" }], metadata: {
    agentSkills: { skills: [], repository: "not-member", diagnostics: [{ source: "user", path: ".agents/skills/big/SKILL.md", problem: "too-large" }] },
  } }] });
  await renderSession();
  const rail = container.querySelector(".agent-session-rail")!;
  expect(rail.textContent).toContain("你不是该仓库成员");
  expect(rail.textContent).toContain(".agents/skills/<name>/SKILL.md");
  const toggle = rail.querySelector<HTMLButtonElement>(".agent-steps-window")!;
  expect(toggle.textContent).toBe("显示 skill 诊断");
  await act(async () => toggle.click());
  expect(rail.textContent).toContain("个人 · 文件过大 · .agents/skills/big/SKILL.md");
  await act(async () => toggle.click());
  expect(rail.textContent).not.toContain(".agents/skills/big/SKILL.md");
});


it("filters follow-up skills, completes with arrows and Enter without sending, caches and dismisses until text changes", async () => {
  await renderSession();
  await type("/week");
  const options = () => [...container.querySelectorAll('[role="option"]')];
  expect(options().map((item) => item.textContent)).toEqual(["/weekly-reportRepositoryWrite a weekly report[week]", "/weekly-reviewPersonalReview a week"]);
  expect(options()[0]?.getAttribute("aria-selected")).toBe("true");
  await key(textarea(), { key: "ArrowDown" });
  expect(options()[1]?.getAttribute("aria-selected")).toBe("true");
  await key(textarea(), { key: "Enter" });
  expect(textarea().value).toBe("/weekly-review ");
  expect(runner.send).not.toHaveBeenCalled();
  expect(options()).toHaveLength(0);
  await type("/weekly-rep");
  expect(options()).toHaveLength(1);
  await key(textarea(), { key: "Escape" });
  expect(textarea().value).toBe("/weekly-rep");
  expect(options()).toHaveLength(0);
  await key(textarea(), { key: "ArrowDown" });
  expect(options()).toHaveLength(0);
  await type("/weekly-re");
  expect(options()).toHaveLength(2);
  await key(textarea(), { key: "ArrowUp" });
  await key(textarea(), { key: "Tab" });
  expect(textarea().value).toBe("/weekly-review ");
  expect(runner.skills).toHaveBeenCalledTimes(1);
  await type("/weekly-report args");
  expect(options()).toHaveLength(0);
});

it("hides the menu and does not fetch skills while running or after a lookup error", async () => {
  current = session({ status: "running" });
  await renderSession();
  await type("/");
  expect(container.querySelector('[role="listbox"]')).toBeNull();
  expect(runner.skills).not.toHaveBeenCalled();
  current = session({ status: "idle" });
  runner.skills.mockRejectedValue(new Error("Unavailable"));
  await renderSession();
  expect(container.querySelector('[role="listbox"]')).toBeNull();
  await type("/week");
  expect(container.querySelector('[role="listbox"]')).toBeNull();
});

it("completes from the shared menu in the real Lexical composer before its send command", async () => {
  const handle: { current: ComposerEditorHandle | null } = { current: null };
  const onSend = vi.fn();
  function Composer() {
    const [text, setText] = useState("/");
    const [starter, setStarter] = useState({ text: "/" });
    const menu = useSkillMenu(text, { kind: "global" }, false, (value) => setStarter({ text: value }));
    return createElement("div", null, createElement(SkillMenu, { menu }), createElement(ComposerEditor, {
      handle, label: "Prompt", busy: false, starter, onSend, onMenuKey: menu.onKeyDown, menuInput: menu.inputProps,
      onChange: (content) => setText(content.text), onTrigger: vi.fn(), onFocus: vi.fn(),
    }));
  }
  await act(async () => root.render(createElement(LanguageProvider, null, createElement(Composer))));
  const editor = handle.current!.editor;
  const input = editor.getRootElement()!;
  assertCombobox(input);
  expect(container.querySelectorAll('[role="option"]')).toHaveLength(2);
  await act(async () => { editor.dispatchCommand(KEY_DOWN_COMMAND, new KeyboardEvent("keydown", { key: "ArrowDown" })); });
  await act(async () => { editor.dispatchCommand(KEY_ENTER_COMMAND, new KeyboardEvent("keydown", { key: "Enter" })); });
  expect(editor.getEditorState().read(() => $getRoot().getTextContent())).toBe("/weekly-review ");
  expect(onSend).not.toHaveBeenCalled();
  expect(input.getAttribute("aria-expanded")).toBe("false");
  expect(input.hasAttribute("aria-activedescendant")).toBe(false);
  expect(container.querySelector('[role="listbox"]')).toBeNull();
});

it("renders invocation pills and orders both invocation and tool use by first use", async () => {
  const skills = ["invoked", "read"].map((name) => ({ name, source: "user", description: name, modelInvocable: true, userInvocable: true }));
  current = session({ messages: [
    { id: "user", role: "user", parts: [{ type: "text", text: "/invoked week" }], metadata: {
      agentSkills: { skills, repository: "no-repository", diagnostics: [] }, agentSkillInvocation: { name: "invoked", source: "user", digest: "a".repeat(64) },
    } },
    { id: "assistant", role: "assistant", parts: [{ type: "dynamic-tool", toolName: "skills_read", toolCallId: "read", state: "output-available", input: { name: "read" }, output: {} }] },
  ] });
  await renderSession();
  expect(container.querySelector(".agent-skill-invocation")?.textContent).toBe("/invoked");
  expect(container.querySelector(".agent-message-user p")?.textContent).toBe("/invoked week");
  expect([...container.querySelectorAll(".agent-skill-name")].map((item) => item.textContent)).toEqual(["invoked", "read"]);
  expect(container.querySelectorAll(".agent-skill-used")).toHaveLength(2);
});


it("caches menu catalogs separately for global scope and each repository", async () => {
  await renderSession();
  await type("/");
  expect(runner.skills).toHaveBeenLastCalledWith({ kind: "global" });
  for (const spaceId of ["repo-a", "repo-b", "repo-a"]) {
    current = { ...current, scope: { kind: "repository", spaceId, baseWorktreeId: null } };
    await renderSession();
    expect(container.querySelector('[role="listbox"]')).not.toBeNull();
  }
  expect(runner.skills.mock.calls).toEqual([
    [{ kind: "global" }], [{ kind: "repository", spaceId: "repo-a", baseWorktreeId: null }],
    [{ kind: "repository", spaceId: "repo-b", baseWorktreeId: null }],
  ]);
});

function assertCombobox(input: HTMLElement) {
  const list = container.querySelector('[role="listbox"]')!;
  const selected = list.querySelector('[aria-selected="true"]')!;
  expect(input.getAttribute("role")).toBe("combobox");
  expect(input.getAttribute("aria-expanded")).toBe("true");
  expect(input.getAttribute("aria-autocomplete")).toBe("list");
  expect(list.id).not.toBe("");
  expect(input.getAttribute("aria-controls")).toBe(list.id);
  expect(selected.id).not.toBe("");
  expect(input.getAttribute("aria-activedescendant")).toBe(selected.id);
  const options = [...list.querySelectorAll<HTMLElement>('[role="option"]')];
  expect(new Set(options.map((option) => option.id)).size).toBe(options.length);
  expect(options.every((option) => option.tabIndex === -1)).toBe(true);
}

it("connects the follow-up combobox to stable options and scrolls the selection", async () => {
  await renderSession();
  expect(textarea().getAttribute("aria-expanded")).toBe("false");
  expect(textarea().hasAttribute("aria-activedescendant")).toBe(false);
  await type("/week");
  assertCombobox(textarea());
  const ids = [...container.querySelectorAll('[role="option"]')].map((option) => option.id);
  scrollIntoView.mockClear();
  await key(textarea(), { key: "ArrowDown" });
  assertCombobox(textarea());
  expect(textarea().getAttribute("aria-activedescendant")).toBe(ids[1]);
  expect([...container.querySelectorAll('[role="option"]')].map((option) => option.id)).toEqual(ids);
  expect(scrollIntoView).toHaveBeenCalledExactlyOnceWith({ block: "nearest" });
  expect(scrollIntoView.mock.contexts[0]).toBe(container.querySelector('[aria-selected="true"]'));
  await key(textarea(), { key: "Escape" });
  expect(textarea().getAttribute("aria-expanded")).toBe("false");
  expect(textarea().hasAttribute("aria-activedescendant")).toBe(false);
});

it("retries failed lookups on the next open and caches the successful result", async () => {
  runner.skills.mockRejectedValueOnce(new Error("Temporary failure"));
  await renderSession(); await type("/week");
  expect(container.querySelector('[role="listbox"]')).toBeNull();
  await type(""); await type("/week");
  expect(container.querySelectorAll('[role="option"]')).toHaveLength(2);
  await type(""); await type("/week");
  expect(runner.skills).toHaveBeenCalledTimes(2);
});

it.each(["shiftKey", "ctrlKey", "metaKey", "altKey"] as const)("passes all menu keys through untouched with %s", async (modifier) => {
  function Menu() {
    const menu = useSkillMenu("/week", { kind: "global" }, false, vi.fn());
    return createElement("div", null, createElement(SkillMenu, { menu }),
      createElement("textarea", { onKeyDown: (event) => menu.onKeyDown(event.nativeEvent) }));
  }
  await act(async () => root.render(createElement(LanguageProvider, null, createElement(Menu))));
  for (const name of ["ArrowUp", "ArrowDown", "Enter", "Tab", "Escape"]) {
    expect((await key(textarea(), { key: name, [modifier]: true })).defaultPrevented).toBe(false);
    expect(container.querySelectorAll('[role="option"]')).toHaveLength(2);
    expect(container.querySelector('[role="option"]')?.getAttribute("aria-selected")).toBe("true");
  }
});

it("leaves Shift+Tab and Shift+Enter native and Ctrl+J inserts a newline with the menu open", async () => {
  await renderSession(); await type("/week");
  for (const name of ["Tab", "Enter"]) expect((await key(textarea(), { key: name, shiftKey: true })).defaultPrevented).toBe(false);
  expect(textarea().value).toBe("/week");
  textarea().setSelectionRange(5, 5);
  await key(textarea(), { key: "j", ctrlKey: true });
  expect(textarea().value).toBe("/week\n");
  expect(runner.send).not.toHaveBeenCalled();
});

it.each(["en-US", "zh-CN"])("labels an invocable builtin in the slash menu in %s", async (language) => {
  window.localStorage.setItem("univer-workspace-language", language);
  runner.skills.mockResolvedValue({ repository: "no-repository", diagnostics: [], skills: [
    { name: "skill-creator", source: "builtin", description: "Create Skills", userInvocable: true, modelInvocable: true },
  ] });
  await renderSession();
  await type("/skill");
  const option = container.querySelector('[role="option"]');
  expect(option?.textContent).toContain(language === "en-US" ? "Built-in" : "内置");
  await key(textarea(), { key: "Enter" });
  expect(textarea().value).toBe("/skill-creator ");
});

it("orders unused repository, personal and builtin skills consistently in the rail", async () => {
  const skills = (["builtin", "user", "repository"] as const).map((source) => ({
    name: `${source}-skill`, source, description: source, modelInvocable: true, userInvocable: true,
  }));
  current = session({ messages: [{ id: "catalog", role: "user", parts: [{ type: "text", text: "Skills" }],
    metadata: { agentSkills: { skills, repository: "loaded", diagnostics: [] } } }] });
  await renderSession();
  expect([...container.querySelectorAll(".agent-skill-name")].map((item) => item.textContent))
    .toEqual(["repository-skill", "user-skill", "builtin-skill"]);
  expect(container.querySelector(".agent-skills")?.textContent).toContain("Built-in");
});
