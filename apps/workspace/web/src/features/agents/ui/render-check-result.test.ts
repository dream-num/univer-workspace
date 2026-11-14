// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { AgentStepsGroup } from "./session-page";
import { session } from "../test-helpers";
import type { ToolPart } from "./summaries";
import type { HtmlViewRenderCheck } from "../../html-views/render-check";

vi.mock("../../../shared/i18n", () => ({ useI18n: () => ({ language: "en-US" }) }));
vi.mock("../../html-views/drafts/draft-review", () => ({ HtmlViewDraftReview: () => null }));

it.each(["passed", "issues", "timed-out", "failed"] as const)("shows the complete %s diagnostic in the expanded save tool row", async (status) => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const renderCheck: HtmlViewRenderCheck = { status, durationMs: 1250,
    issues: status === "issues" ? [{ kind: "page-error", message: "B7 must contain a start month" }] : [],
    ...(["timed-out", "failed"].includes(status) ? { reason: "Check did not complete" } : {}),
  };
  const part: ToolPart = { type: "dynamic-tool", toolName: "html_view_create", toolCallId: "call", input: {}, state: "output-available",
    output: { structuredContent: { draft: { id: "draft" }, renderCheck } },
  };
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(AgentStepsGroup, { parts: [part], session: session() })));
    expect(container.querySelector("pre")).toBeNull();
    await act(async () => container.querySelector<HTMLButtonElement>(".agent-step-row")!.click());
    expect(container.textContent).toContain("Render check");
    expect(JSON.parse(container.querySelector("pre")!.textContent!)).toEqual(renderCheck);
  } finally { await act(async () => root.unmount()); container.remove(); }
});
