import { z } from "zod";
import { skillCatalogSchema, skillEntrySchema, SYSTEM_REMINDER_START } from "../agent.types";
import type { AgentScope, SkillCatalog } from "../agent.types";

export const gatewaySkillCatalogSchema = skillCatalogSchema.extend({
  skills: z.array(skillEntrySchema.extend({ source: z.enum(["builtin", "repository", "user"]) })),
}).transform((catalog): SkillCatalog => ({
  ...catalog, skills: catalog.skills.flatMap((skill) => skill.source === "builtin" ? [] : [{ ...skill, source: skill.source }]),
}));

export function skillsReminder(catalog: SkillCatalog, previous: SkillCatalog | null, scope: AgentScope): { type: "text"; text: string } | null {
  const visible = (value: SkillCatalog | null) => value?.skills.filter((skill) => skill.modelInvocable)
    .map(({ name, source, description }) => ({ name, source, description })) ?? [];
  const skills = visible(catalog);
  if (JSON.stringify(skills) === JSON.stringify(visible(previous))) return null;
  const descriptions = skills.map((skill) => skill.description.replaceAll("<", "\\u003c"));
  const render = () => [`\n\n${SYSTEM_REMINDER_START}`,
    "Skills available in this session. This list replaces any earlier one.",
    `Read a skill with skills_read {"name": "<name>"${scope.kind === "repository" ? `, "repo": ${JSON.stringify(scope.spaceId).replaceAll("<", "\\u003c")}` : ""}} before using it.`,
    ...(skills.length ? skills.map((skill, index) => `- ${skill.name.replaceAll("<", "\\u003c")} (${skill.source}): ${descriptions[index]}`) : ["No skills are available now."]),
    "</system-reminder>"].join("\n");
  let text = render();
  if (text.length > 8000) {
    const lengths = descriptions.map((description) => description.length).sort((a, b) => b - a);
    let limit = lengths[0] ?? 0;
    let excess = text.length - 8000;
    for (let count = 1; count <= lengths.length && excess > 0; count++) {
      const next = lengths[count] ?? 0;
      const reduction = (limit - next) * count;
      if (reduction >= excess) { limit -= Math.ceil(excess / count); break; }
      excess -= reduction;
      limit = next;
    }
    for (let index = 0; index < descriptions.length; index++) {
      const description = descriptions[index]!;
      if (description.length > limit) descriptions[index] = description.slice(0, limit).replace(/\\(?:u0{0,2}3?)?$/, "");
    }
    text = render();
  }
  return { type: "text", text };
}
