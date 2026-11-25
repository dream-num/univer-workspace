import { expect, it } from "vitest";
import { declarationProblem, declaredCheckNames } from "../../server/src/modules/worktrees/checks.js";

it.each([
  ["## totals-match\n```md\n## not-a-check\n```\n### Notes\n##notes\n", null],
  ["## totals-match\r\n## header-unchanged\r\n", null],
  ["\uFEFF## totals-match\n", ".agents/checks.md starts with a byte order mark, which hides its first heading."],
  ["## totals-match\n  ## header-unchanged\n", '.agents/checks.md has a heading that is not a check name: "## header-unchanged".'],
  ["## totals-match\n##\n", '.agents/checks.md has a heading that is not a check name: "##".'],
  ["## totals-match\n## totals-match\n", ".agents/checks.md declares totals-match twice."],
  ["~~~\n## totals-match\n", ".agents/checks.md has a code fence that is never closed."],
])("judges %j as the merge gate reads it", (text, problem) => {
  const found = declarationProblem(text);
  if (problem === null) expect(found).toBeNull();
  else expect(found).toContain(problem);
});

it("reads every name the strict reading accepts the same way the check list does", () => {
  const text = "## totals-match\n```md\n## not-a-check\n```\n## header-unchanged\n";
  expect(declarationProblem(text)).toBeNull();
  expect(declaredCheckNames(text)).toEqual(["totals-match", "header-unchanged"]);
});
