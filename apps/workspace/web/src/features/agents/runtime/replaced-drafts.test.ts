import type { UIMessage } from "ai";
import { expect, it, vi } from "vitest";
import { replacedDraftIds } from "../replaced-drafts";
import { draftReminder, type DraftStatus } from "./draft-reminder";

function draft(id: string, toolName = "html_view_save", input: unknown = { space: "sales", name: "Report" }): UIMessage {
  return { id, role: "assistant", parts: [{ type: "dynamic-tool", toolName, toolCallId: id, state: "output-available", input,
    output: { structuredContent: { draft: { id, state: "pending" } } } }] };
}

it("replaces create drafts by space and suffix-normalized name without changing history", () => {
  const messages = [draft("a"), draft("b", "html_view_save", { space: "sales", name: "Report.univer.html" }),
    draft("c", "html_view_save", { space: "sales", name: "Report" })];
  const before = structuredClone(messages);
  expect(replacedDraftIds(messages)).toEqual(new Set(["a", "b"]));
  expect(messages).toEqual(before);
});

it("keeps different create and replace targets independent, including static tool parts", () => {
  const staticDraft: UIMessage = { id: "replace-new", role: "assistant", parts: [{ type: "tool-html_view_save", toolCallId: "new",
    state: "output-available", input: { page: "page", etag: '"v1"' }, output: { structuredContent: { draft: { id: "new" } } } }] };
  expect(replacedDraftIds([draft("a"), draft("space", "html_view_save", { space: "other", name: "Report" }),
    draft("name", "html_view_save", { space: "sales", name: "Other" }), draft("old", "html_view_save", { page: "page", etag: '"v1"' }),
    draft("other-page", "html_view_save", { page: "other", etag: '"v1"' }), staticDraft])).toEqual(new Set(["old"]));
});

it("ignores failed calls, error outputs, malformed results and unrelated tools", () => {
  const errors: UIMessage = { id: "errors", role: "assistant", parts: [
    { type: "tool-html_view_save", toolCallId: "failed", state: "output-error", input: { space: "sales", name: "Report" }, errorText: "Failed" },
    { type: "tool-html_view_save", toolCallId: "error", state: "output-available", input: { space: "sales", name: "Report" },
      output: { isError: true, structuredContent: { draft: { id: "error" } } } },
    { type: "tool-html_view_save", toolCallId: "malformed", state: "output-available", input: { space: "sales", name: "Report" }, output: {} },
  ] };
  expect(replacedDraftIds([draft("a"), errors, draft("unrelated", "browse"), draft("invalid", "html_view_save", {})])).toEqual(new Set());
});

it("does not replace an idempotent retry of the same draft", () => {
  expect(replacedDraftIds([draft("a"), draft("a")])).toEqual(new Set());
});

it.each(["pending", "published", "rejected", "expired", "conflicted", "superseded"] as const)("never looks up a replaced draft that is now %s", async (state) => {
  const getDraft = vi.fn(async (id: string): Promise<DraftStatus> => ({ state: id === "old" ? state : "pending", name: "Report", published: null }));
  const reminder = await draftReminder([draft("old"), draft("new")], getDraft, "https://workspace.test");
  expect(getDraft).toHaveBeenCalledExactlyOnceWith("new");
  expect(reminder).toEqual({ states: {}, part: null });
});

it("keeps the reminder text and metadata for other drafts unchanged", async () => {
  const reminder = await draftReminder([draft("old"), draft("new"), draft("other", "html_view_save", { space: "sales", name: "Other" })],
    async (id) => ({ state: id === "new" ? "pending" : "expired", name: "Other", published: null }), "https://workspace.test");
  expect(reminder).toEqual({ states: { other: "expired" }, part: { type: "text", text: '\n\n<system-reminder>\nDraft "other" "Other": expired. It was not published; draft again only if the user asks.\n</system-reminder>' } });
});

it("reports superseded once without publishing or mutating the sent history", async () => {
  const messages = [draft("old")];
  const before = structuredClone(messages);
  const getDraft = vi.fn(async (): Promise<DraftStatus> => ({ state: "superseded", name: "Report", published: null }));
  const result = await draftReminder(messages, getDraft, "https://workspace.test");
  expect(result.states).toEqual({ old: "superseded" });
  expect(result.part?.text).toContain("superseded. It was not published because a newer draft replaced it");
  expect(messages).toEqual(before);
  const next: UIMessage = { id: "user", role: "user", parts: [{ type: "text", text: "Thanks" }], metadata: { agentDraftStates: result.states } };
  getDraft.mockClear();
  expect(await draftReminder([...messages, next], getDraft, "https://workspace.test")).toEqual({ states: {}, part: null });
  expect(getDraft).not.toHaveBeenCalled();
});
