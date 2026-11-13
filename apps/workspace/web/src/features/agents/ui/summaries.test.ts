import { describe, expect, it, vi } from "vitest";
import type { UIMessage } from "ai";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentStepsGroup } from "./session-page";
import { SessionStatus } from "./sessions";
import { ApprovalCard } from "./approval-card";
import type { StepPart, ToolPart } from "./summaries";
import { argumentSummary, cacheHitRate, durationLabel, newestSessions, visibleSessions, messageBlocks, sessionStatus, toolStatus, pullRequestUrl, resultSummary, summarize } from "./summaries";
import { session } from "../test-helpers";
import { agentSessionIdSchema } from "../agent.types";
import { agentMessages } from "./messages";

const i18n = vi.hoisted((): { language: "en-US" | "zh-CN" } => ({ language: "en-US" }));
vi.mock("../../../shared/i18n", () => ({ useI18n: () => i18n }));
vi.mock("../../html-views/drafts/draft-review", () => ({
  HtmlViewDraftReview: ({ draftId, presentation }: { draftId: string; presentation: string }) =>
    createElement("section", { "data-draft-id": draftId, "data-presentation": presentation }),
}));

describe("Agent session status badges", () => {
  const request = { id: "approval-message", role: "assistant", parts: [{
    type: "dynamic-tool", toolName: "blob_upload", toolCallId: "publish", state: "approval-requested",
    input: { name: "File", repo: "repo", upload_id: "upload" }, approval: { id: "approval" },
  }] } satisfies UIMessage;

  it.each(["en-US", "zh-CN"] as const)("shows pending approvals in %s", (language) => {
    const pending = session({ messages: [request] });
    expect(sessionStatus(pending)).toBe("waitingApproval");
    i18n.language = language;
    try {
      const html = renderToStaticMarkup(createElement(SessionStatus, { session: pending }));
      expect(html).toContain(language === "en-US" ? "Waiting for approval" : "等待批准");
      expect(html).toContain('data-status="waitingApproval"');
      expect(html).not.toContain(agentMessages[language].idle);
    } finally { i18n.language = "en-US"; }
  });
  it("preserves stored status when there is no open approval", () => {
    for (const status of ["running", "idle", "interrupted", "stopped", "failed"] as const) {
      expect(sessionStatus(session({ status }))).toBe(status);
    }
    expect(sessionStatus(session({ status: "running", messages: [request] }))).toBe("running");
    expect(sessionStatus(session({ messages: [request, { id: "followup", role: "user", parts: [{ type: "text", text: "Change the page" }] }] }))).toBe("idle");
  });
});

describe("Agent tool cards", () => {
  it("formats cache hit rates as whole percentages or a placeholder when unavailable", () => {
    expect(cacheHitRate(null)).toBe("—");
    expect(cacheHitRate(undefined)).toBe("—");
    expect(cacheHitRate({ inputTokens: 0, cacheReadTokens: 0 })).toBe("—");
    expect(cacheHitRate({ inputTokens: 300, cacheReadTokens: 280 })).toBe("93%");
    expect(cacheHitRate({ inputTokens: 100, cacheReadTokens: 0 })).toBe("0%");
  });
  it("summarizes structured gateway results and bounds large arguments", () => {
    expect(resultSummary({ structuredContent: { number: 7 }, content: [] })).toBe("#7");
    expect(summarize({ file: "Budget.xlsx" })).toBe('{"file":"Budget.xlsx"}');
    expect(summarize("x".repeat(500))).toBe("x".repeat(300) + "…");
    expect(summarize(undefined)).toBe("—");
  });
  it("keeps collapsed arguments useful, single-line and at most 80 characters", () => {
    expect(argumentSummary({ code: "large script", repo: "finance", query: "Sales\nQ4", unit: "budget", range: "A1:B2" })).toBe("repo: finance · query: Sales Q4 · unit: budget · range: A1:B2");
    expect(argumentSummary({ title: "x".repeat(200) })).toBe("title: " + "x".repeat(72) + "…");
    expect(argumentSummary({})).toBe("");
  });
  it("describes PRs, gateway errors and list results without dumping JSON", () => {
    expect(resultSummary({ structuredContent: { number: 3, url: "https://space.test/pr" } }, "Done", { title: "Q4 summary" })).toBe("#3 Q4 summary");
    expect(resultSummary({ structuredContent: { code: "NO_ACCESS", message: "Permission\ndenied" }, isError: true })).toBe("NO_ACCESS: Permission denied");
    expect(resultSummary({ error: { code: "BUSY", message: "Try later" } })).toBe("BUSY: Try later");
    expect(resultSummary({ content: [{ type: "text", text: '{"code":"INVALID","message":"Bad range"}' }] })).toBe("INVALID: Bad range");
    expect(resultSummary({ structuredContent: { nodes: [{ id: "1", name: "Sales Q4" }, { name: "Budget" }] } })).toBe("Sales Q4 · Budget");
    expect(resultSummary({ unfamiliar: {} }, "已完成")).toBe("已完成");
    expect(resultSummary("a\n".repeat(200))).toHaveLength(160);
  });
  it("formats completed tool duration and handles unfinished or invalid timing", () => {
    expect(durationLabel("2026-11-11T00:00:00Z", "2026-11-11T00:00:00.250Z")).toBe("250 ms");
    expect(durationLabel("2026-11-11T00:00:00Z", "2026-11-11T00:00:02.500Z")).toBe("2.5 s");
    expect(durationLabel("bad", "bad")).toBe("—");
    expect(durationLabel("2026-11-11T00:00:00Z", null)).toBe("—");
    expect(durationLabel("2026-11-11T00:00:02Z", "2026-11-11T00:00:00Z")).toBe("—");
  });
  it("links only same-origin Workspace pull request paths", () => {
    const origin = "https://space.test";
    expect(pullRequestUrl({ structuredContent: { url: `${origin}/spaces/s/pulls/1` } }, origin)).toBe(`${origin}/spaces/s/pulls/1`);
    expect(pullRequestUrl({ url: `${origin}/spaces/repo-1/pulls/42` }, origin)).toBe(`${origin}/spaces/repo-1/pulls/42`);
    for (const url of [
      "https://other.test/spaces/s/pulls/1", "https://space.test.evil.test/spaces/s/pulls/1",
      "http://space.test/spaces/s/pulls/1", "https://space.test:444/spaces/s/pulls/1",
      `${origin}/pr`, `${origin}/spaces/s/pulls/abc`, `${origin}/spaces/s/pulls/1/extra`,
      `${origin}/spaces//pulls/1`, "javascript:alert(1)", "data:text/html,test", "/spaces/s/pulls/1",
    ]) expect(pullRequestUrl({ url }, origin), url).toBeNull();
    expect(pullRequestUrl(null, origin)).toBeNull();
  });
  it("shows newest sessions first and isolates repository sessions", () => {
    const older = session({ id: agentSessionIdSchema.parse("older") });
    const newer = session({ id: agentSessionIdSchema.parse("newer"), createdAt: "2026-11-11T01:00:00.000Z", scope: { kind: "repository", spaceId: "space-a", baseWorktreeId: null } });
    const other = session({ id: agentSessionIdSchema.parse("other"), scope: { kind: "repository", spaceId: "space-b", baseWorktreeId: null } });
    const all = [older, newer, other];
    expect(newestSessions(all).map((item) => item.id)).toEqual(["newer", "older", "other"]);
    expect(newestSessions(all, "space-a").map((item) => item.id)).toEqual(["newer"]);
    expect(all.map((item) => item.id)).toEqual(["older", "newer", "other"]);
  });
  it("searches session titles across scopes and statuses without changing newest-first order", () => {
    const titled = (id: string, title: string) => session({ id: agentSessionIdSchema.parse(id), messages: [{ id: `message-${id}`, role: "user", parts: [{ type: "text", text: title }, { type: "text", text: "<system-reminder>hidden scope</system-reminder>" }] }] });
    const older = titled("older", "Budget summary");
    const newer = { ...titled("newer", "BUDGET formulas"), status: "failed", createdAt: "2026-11-12T01:00:00.000Z", scope: { kind: "repository", spaceId: "other", baseWorktreeId: null } } satisfies ReturnType<typeof session>;
    const all = [older, titled("other", "Other work"), newer];
    expect(visibleSessions(all, " budget ", "en-US").map((item) => item.id)).toEqual(["newer", "older"]);
    expect(visibleSessions(all, "hidden scope", "en-US")).toEqual([]);
    expect(visibleSessions(all, "", "en-US")).toHaveLength(3);
    expect(all.map((item) => item.id)).toEqual(["older", "other", "newer"]);
  });
  it("provides the same translated labels in both languages", () => {
    expect(Object.keys(agentMessages["en-US"]).sort()).toEqual(Object.keys(agentMessages["zh-CN"]).sort());
  });
});

describe("Agent steps groups", () => {
  it.each([false, true, undefined])("defaults to expanded only for the latest group (%s)", (latest) => {
    const parts: StepPart[] = [{ type: "reasoning", text: "Plan", state: "done" }];
    const html = renderToStaticMarkup(createElement(AgentStepsGroup, { parts, session: session(), ...(latest === undefined ? {} : { latest }) }));
    expect(html).toContain(`class="agent-steps-head" aria-expanded="${latest !== false}"`);
    if (latest === false) expect(html).not.toContain('class="agent-steps-list"');
    else expect(html).toContain('class="agent-steps-list"');
  });
  it("keeps skipped parts inside a run and splits only on visible text", () => {
    const thought = { type: "reasoning", text: "Plan", state: "done" } satisfies UIMessage["parts"][number];
    const tool = { type: "dynamic-tool", toolName: "browse", toolCallId: "call-a", state: "output-available", input: {}, output: {} } satisfies UIMessage["parts"][number];
    const text = { type: "text", text: "Answer" } satisfies UIMessage["parts"][number];
    expect(messageBlocks([thought, { type: "step-start" }, { type: "text", text: " \n " },
      { type: "source-url", sourceId: "source-a", url: "https://space.test" },
      { type: "file", mediaType: "text/plain", url: "https://space.test/file" }, tool, text, thought])).toEqual([
      { kind: "steps", parts: [thought, tool] }, { kind: "text", part: text }, { kind: "steps", parts: [thought] },
    ]);
  });
  it("classifies tool outcomes and spins only during a running session", () => {
    const pending = { type: "dynamic-tool", toolName: "browse", toolCallId: "call-a", state: "input-available", input: {} } satisfies ToolPart;
    const tool = { ...pending, state: "output-available", output: {} } satisfies ToolPart;
    expect(toolStatus(tool, "idle")).toBe("completed");
    expect(toolStatus({ ...pending, state: "output-error", errorText: "Failed" }, "running")).toBe("failed");
    expect(toolStatus({ ...pending, state: "output-denied", approval: { id: "approval-a", approved: false } }, "idle")).toBe("rejected");
    expect(toolStatus({ ...tool, output: { isError: true } }, "idle")).toBe("failed");
    expect(toolStatus(pending, "running")).toBe("running");
    expect(toolStatus(pending, "stopped")).toBe("incomplete");
  });
  it.each(["en-US", "zh-CN"] as const)("shows rejected calls without a failure summary in %s", (language) => {
    const denied = { type: "dynamic-tool", toolName: "blob_upload", toolCallId: "publish", state: "output-denied", input: {}, approval: { id: "approval", approved: false } } satisfies ToolPart;
    i18n.language = language;
    try {
      const html = renderToStaticMarkup(createElement(AgentStepsGroup, { parts: [denied], session: session() }));
      const label = language === "en-US" ? "Rejected" : "已拒绝";
      expect(html).toContain('data-status="rejected"');
      expect(html).toContain(`aria-label="${label}"`);
      expect(html).toContain(`<span>${label}</span>`);
      expect(html).not.toContain("agent-steps-failed");
      expect(html).not.toContain('aria-label="' + agentMessages[language].toolFailed + '"');
    } finally { i18n.language = "en-US"; }
  });
  it("shows working for the current group of a running session, including between model steps", () => {
    const tool = { type: "dynamic-tool", toolName: "browse", toolCallId: "call-a", state: "input-available", input: { query: "Sales" } } satisfies ToolPart;
    const render = (parts: StepPart[], status: "running" | "stopped", current: boolean) => renderToStaticMarkup(createElement(AgentStepsGroup, { parts, session: session({ status }), current }));
    expect(render([tool], "running", true)).toContain("Working");
    expect(render([tool], "running", true)).toContain("browse query: Sales");
    expect(render([tool], "running", false)).not.toContain("Working");
    expect(render([tool], "stopped", true)).not.toContain("Working");
    expect(render([{ ...tool, state: "output-available", output: {} }], "running", true)).toContain("Working");
    expect(render([{ type: "reasoning", text: "Plan", state: "streaming" }], "running", true)).toContain("Thinking");
  });
  it("counts failures even when they are outside the recent window", () => {
    const call = { type: "dynamic-tool", toolName: "browse", toolCallId: "call-a", state: "input-available", input: {} } satisfies ToolPart;
    const parts: StepPart[] = [
      { ...call, state: "output-error", errorText: "Failed" },
      { ...call, state: "output-available", output: { isError: true } },
      { ...call, state: "output-denied", approval: { id: "approval", approved: false } },
      ...Array.from({ length: 5 }, (): StepPart => ({ type: "reasoning", text: "Plan", state: "done" })),
    ];
    const html = renderToStaticMarkup(createElement(AgentStepsGroup, { parts, session: session() }));
    expect(html).toContain("5 thoughts · 3 tool calls");
    expect(html).toContain("2 failed");
    expect(html).not.toContain("browse");
  });
  it("renders only the latest five of eight steps without mounting closed bodies", () => {
    const parts: StepPart[] = Array.from({ length: 8 }, (_, index) => index % 2 === 0
      ? { type: "reasoning", state: "done", text: `Thought preview ${index}\nPRIVATE REASONING BODY ${index}` }
      : { type: "dynamic-tool", toolName: `tool_${index}`, toolCallId: `call-${index}`, state: "output-available", input: { query: `query ${index}`, code: "PRIVATE ARGUMENT BODY" }, output: { text: "PRIVATE RESULT BODY" } });
    const html = renderToStaticMarkup(createElement(AgentStepsGroup, { parts, session: session() }));
    expect(html.match(/class="agent-step-row"/g)).toHaveLength(5);
    expect(html).toContain("Show 3 earlier steps");
    expect(html).toContain("4 thoughts · 4 tool calls");
    expect(html).not.toContain("Thought preview 0");
    expect(html).not.toContain("tool_1");
    expect(html).not.toContain("Thought preview 2");
    for (const label of ["tool_3", "Thought preview 4", "tool_5", "Thought preview 6", "tool_7"]) expect(html).toContain(label);
    expect(html).not.toContain("PRIVATE");
    expect(html).not.toContain("<dl");
    expect(html).not.toContain("issue-markdown");
  });
});


describe("Agent page drafts", () => {
  const output = { content: [], structuredContent: { draft: { id: "draft-1" } } };
  function render(part: ToolPart) {
    const saved = session({ messages: [{ id: "assistant", role: "assistant", parts: [part] }] });
    return { saved, html: renderToStaticMarkup(createElement(AgentStepsGroup, { parts: saved.messages[0]!.parts.filter((part): part is ToolPart => "toolCallId" in part), session: saved })) };
  }
  it.each(["html_view_create", "html_view_replace"])("renders one review card for %s without waiting for approval or changing history", (toolName) => {
    const part = { type: "dynamic-tool", toolName, toolCallId: "page", state: "output-available", input: {}, output } satisfies ToolPart;
    const before = structuredClone(part);
    const { saved, html } = render(part);
    expect(html.match(/data-draft-id="draft-1"/g)).toHaveLength(1);
    expect(html).toContain('data-presentation="card"');
    expect(sessionStatus(saved)).toBe("idle");
    expect(saved.messages).toEqual([{ id: "assistant", role: "assistant", parts: [before] }]);
  });
  it("reads static tool parts", () => {
    expect(render({ type: "tool-html_view_replace", toolCallId: "page", state: "output-available", input: {}, output }).html)
      .toContain('data-draft-id="draft-1"');
  });
  it.each([null, {}, { draft: { id: "draft-1" } }, { structuredContent: { draft: { id: "" } } },
    { structuredContent: { draft: { id: 1 } } }, { ...output, isError: true }])("ignores malformed or error output %j", (output) => {
    expect(render({ type: "dynamic-tool", toolName: "html_view_create", toolCallId: "page", state: "output-available", input: {}, output }).html)
      .not.toContain("data-draft-id");
  });
  it("ignores failed calls and unrelated tools", () => {
    expect(render({ type: "tool-html_view_create", toolCallId: "page", state: "output-error", input: {}, errorText: "Failed" }).html).not.toContain("data-draft-id");
    expect(render({ type: "tool-browse", toolCallId: "page", state: "output-available", input: {}, output }).html).not.toContain("data-draft-id");
  });
});


it("renders a generic publication approval without HTML preview controls", () => {
  const html = renderToStaticMarkup(createElement(ApprovalCard, {
    approval: { approvalId: "approval", toolCallId: "call", toolName: "blob_upload", action: { kind: "other", input: { upload_id: "upload-1" } } },
    disabled: false, onDecide: () => {},
  }));
  expect(html).toContain("Approve publication");
  expect(html).toContain("blob_upload");
  expect(html).toContain("upload-1");
  expect(html).toContain(">Publish</button>");
  expect(html).toContain(">Reject</button>");
  expect(html).not.toContain("preview");
  expect(html).not.toContain("Source Sheets");
});
