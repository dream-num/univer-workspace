import { expect, it } from "vitest";
import { messageSkills } from "../agent.types";
import type { SkillCatalog } from "../agent.types";
import { gatewaySkillCatalogSchema, skillsReminder } from "./skills";

const catalog: SkillCatalog = { skills: [], diagnostics: [], repository: "no-repository" };
it("validates persisted metadata and rejects old gateway payloads", () => {
  expect(messageSkills({ agentSkills: catalog })).toEqual(catalog);
  expect(messageSkills({ agentSkills: { skills: [] } })).toBeNull();
  expect(gatewaySkillCatalogSchema.safeParse({ skills: [{ name: "core", description: "Core" }] }).success).toBe(false);
});
it("shortens the longest descriptions to fit while keeping every name and escaping markup", () => {
  const skills = Array.from({ length: 12 }, (_, index) => ({ name: `skill-${index}`, source: "repository" as const,
    modelInvocable: true, userInvocable: true, description: index ? "short" : "<".repeat(2000) }));
  const reminder = skillsReminder({ ...catalog, skills }, null)!.text;
  expect(reminder.length).toBeLessThanOrEqual(8000);
  expect(reminder.match(/<\/system-reminder>/g)).toHaveLength(1);
  for (const skill of skills) expect(reminder).toContain(`- ${skill.name} (repository):`);
  expect(reminder).toContain("- skill-1 (repository): short");
  expect(reminder).toContain("\\u003c");
});
it("ignores hidden skills, paths and diagnostics when comparing the model-visible catalog", () => {
  const hidden = { name: "manual", description: "Manual", source: "user" as const, modelInvocable: false, userInvocable: true };
  expect(skillsReminder({ ...catalog, skills: [hidden] }, null)).toBeNull();
  const visible = { ...hidden, modelInvocable: true };
  expect(skillsReminder({ ...catalog, skills: [{ ...visible, path: "changed" }], repository: "loaded" }, { ...catalog, skills: [visible] })).toBeNull();
});

it("fits a large catalog of equally long descriptions without dropping names", () => {
  const skills = Array.from({ length: 100 }, (_, index) => ({ name: `skill-${index}`, source: "user" as const,
    modelInvocable: true, userInvocable: true, description: "<".repeat(1024) }));
  const reminder = skillsReminder({ ...catalog, skills }, null)!.text;
  expect(reminder.length).toBeLessThanOrEqual(8000);
  for (const skill of skills) expect(reminder).toContain(`- ${skill.name} (user):`);
  expect(reminder).not.toMatch(/\\u0{0,2}3?\n/);
});

it("cuts shortened descriptions on code point boundaries", () => {
  const skills = Array.from({ length: 10 }, (_, index) => ({ name: `skill-${index}`, source: "user" as const, modelInvocable: true,
    userInvocable: true, description: (index % 2 ? "a" : "") + "\u{1F600}".repeat(index % 2 ? 511 : 512) }));
  const reminder = skillsReminder({ ...catalog, skills }, null)!.text;
  expect(reminder.length).toBeLessThanOrEqual(8000);
  expect(reminder).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
});
