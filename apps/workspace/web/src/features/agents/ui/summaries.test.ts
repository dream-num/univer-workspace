import { describe, expect, it } from "vitest";
import { argumentSummary, durationLabel, newestSessions, pullRequestUrl, resultSummary, summarize } from "./summaries";
import { session } from "../test-helpers";
import { agentSessionIdSchema } from "../agent.types";
import { agentMessages } from "./messages";

describe("Agent tool cards", () => {
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
  it("provides the same translated labels in both languages", () => {
    expect(Object.keys(agentMessages["en-US"]).sort()).toEqual(Object.keys(agentMessages["zh-CN"]).sort());
  });
});
