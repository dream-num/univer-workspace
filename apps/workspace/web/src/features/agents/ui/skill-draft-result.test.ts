import { expect, it } from "vitest";
import { skillDraftResultId } from "./skill-draft-result";

it("opens Skill draft results only for successful create and get steps", () => {
  const output = { structuredContent: { draft: { id: "draft-1", name: "weekly-report" } } };
  expect(skillDraftResultId("skill_draft_create", output)).toBe("draft-1");
  expect(skillDraftResultId("skill_draft_get", output)).toBe("draft-1");
  expect(skillDraftResultId("html_view_create", output)).toBeNull();
  expect(skillDraftResultId("skill_draft_create", { ...output, isError: true })).toBeNull();
  for (const invalid of [null, {}, { structuredContent: { draft: { id: "" } } }]) expect(skillDraftResultId("skill_draft_get", invalid)).toBeNull();
});
