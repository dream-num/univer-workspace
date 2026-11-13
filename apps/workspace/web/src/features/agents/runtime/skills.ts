import type { UIMessage } from "ai";
import { z } from "zod";
import { skillCatalogSchema, messageSkillInvocation, SYSTEM_REMINDER_START } from "../agent.types";
import type { SkillCatalog } from "../agent.types";

export const gatewaySkillCatalogSchema = skillCatalogSchema.transform((catalog): SkillCatalog => ({
  ...catalog, skills: catalog.skills.filter((skill) => skill.source !== "builtin" || skill.userInvocable),
}));

export function skillsReminder(catalog: SkillCatalog, previous: SkillCatalog | null): { type: "text"; text: string } | null {
  const visible = (value: SkillCatalog | null) => value?.skills.filter((skill) => skill.source !== "builtin" && skill.modelInvocable)
    .map(({ name, source, description }) => ({ name, source, description })) ?? [];
  const skills = visible(catalog);
  if (JSON.stringify(skills) === JSON.stringify(visible(previous))) return null;
  const descriptions = skills.map((skill) => skill.description.replaceAll("<", "\\u003c"));
  const render = () => [`\n\n${SYSTEM_REMINDER_START}`,
    "Skills available in this session. This list replaces any earlier one.",
    'Read a skill with skills_read {"name": "<name>"} before using it. In a repository scope, also pass the current Space ID as repo.',
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
      if (description.length > limit) descriptions[index] = description.slice(0, limit).replace(/\\(?:u0{0,2}3?)?$/, "").replace(/[\uD800-\uDBFF]$/, "");
    }
    text = render();
  }
  return { type: "text", text };
}

const gatewaySkillBodySchema = z.object({
  content: z.string(), resources: z.array(z.object({ path: z.string(), readCommand: z.string() })).optional(),
});

export async function skillInvocation(message: UIMessage, catalog: SkillCatalog, previous: UIMessage[],
  read: (name: string) => Promise<unknown>,
) {
  const text = message.parts.find((part) => part.type === "text")?.text;
  const match = text?.match(/^\/([a-z0-9]+(?:-[a-z0-9]+)*)(?:\s+([\s\S]*))?$/);
  if (!match) return null;
  const skill = catalog.skills.find((item) => item.name === match[1] && item.userInvocable);
  if (!skill) return null;
  const body = gatewaySkillBodySchema.parse(await read(skill.name));
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body.content));
  const digest = Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
  const invocation = { name: skill.name, source: skill.source, digest };
  const repeated = previous.some((item) => {
    const earlier = item.role === "user" ? messageSkillInvocation(item.metadata) : null;
    return earlier?.name === skill.name && earlier.digest === digest;
  });
  const args = match[2]?.trim() ?? "";
  const rendered = body.content.includes("$ARGUMENTS") ? body.content.replaceAll("$ARGUMENTS", () => args)
    : body.content + (args ? `\n\nARGUMENTS: ${args}` : "");
  const escape = (value: string) => value.replace(/<(?=\/?system-reminder)/gi, "\\u003c");
  return { invocation, part: { type: "text" as const, text: [
    `\n\n${SYSTEM_REMINDER_START}`,
    repeated ? `The user invoked ${skill.name} again. Its instructions are already loaded above in this conversation.`
      : `The user invoked the ${skill.source} skill "${skill.name}" with /${skill.name}. Follow these instructions for this request.`,
    ...(repeated ? (args ? [escape(`ARGUMENTS: ${args}`)] : []) : [escape(rendered), ...(body.resources ?? []).map((resource) => escape(resource.readCommand))]),
    "</system-reminder>",
  ].join("\n") } };
}
