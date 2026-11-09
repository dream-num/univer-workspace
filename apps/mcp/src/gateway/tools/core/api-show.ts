import type { ApiReferenceShowResult } from "@univer-cli/api-reference";
import { z } from "zod";
import { decodeCursor, encodeCursor, fitsPage, resultTooLarge } from "../../paging.js";
import { readOnlyAnnotations, type ToolDefinition } from "../definition.js";
import { apiReference } from "./api-reference.js";

const inputSchema = z.object({
  symbols: z
    .array(z.string().min(1))
    .min(1)
    .describe(
      "Exact API symbols: a class (FRange), a member (FRange.setValues), a type, or a type member (ICellData.v).",
    ),
  cursor: z
    .string()
    .optional()
    .describe(
      "The cursor of a truncated result. Repeat the call with the same symbols to continue.",
    ),
});

// A class is paged member by member, every other result as a whole.
interface Unit {
  readonly result: number;
  readonly group: number;
  readonly member: number;
}

function unitsOf(results: readonly ApiReferenceShowResult[]): Unit[] {
  return results.flatMap((result, index) => {
    if (result.status !== "found" || result.kind !== "class") {
      return [{ result: index, group: -1, member: -1 }];
    }
    const members = result.groups.flatMap((group, g) =>
      group.members.map((_, m) => ({ result: index, group: g, member: m })),
    );
    return members.length === 0 ? [{ result: index, group: -1, member: -1 }] : members;
  });
}

// Pages of one class repeat its header (declaration, lineage, documentation) and carry a slice of its groups.
function assemble(results: readonly ApiReferenceShowResult[], units: readonly Unit[]) {
  const picked = new Set(
    units.map((u) => `${String(u.result)}:${String(u.group)}:${String(u.member)}`),
  );
  const whole = new Set(units.filter((u) => u.group === -1).map((u) => u.result));
  return results.flatMap((result, index) => {
    if (whole.has(index)) return [result];
    if (result.status !== "found" || result.kind !== "class") return [];
    const groups = result.groups
      .map((group, g) => ({
        ...group,
        members: group.members.filter((_, m) =>
          picked.has(`${String(index)}:${String(g)}:${String(m)}`),
        ),
      }))
      .filter((group) => group.members.length > 0);
    return groups.length === 0 ? [] : [{ ...result, groups }];
  });
}

export const apiShowTool: ToolDefinition = {
  name: "api_show",
  toolset: "core",
  scope: "read",
  title: "Show Facade API details",
  description:
    "Show exact declarations, JSDoc, overloads and related types for Univer Facade API symbols from the offline reference. A class result lists all its members and can be long: the result then has truncated: true and a cursor, and calling api_show again with the same symbols and that cursor returns the next members of the class. An unknown symbol returns status not-found with suggestions.",
  inputSchema,
  outputSchema: z.object({
    results: z.array(
      z.looseObject({
        status: z.enum(["found", "not-found"]),
        kind: z.string(),
        query: z.string(),
      }),
    ),
    truncated: z.boolean().optional(),
    cursor: z.string().optional(),
  }),
  annotations: readOnlyAnnotations,
  async run(_context, args) {
    const { symbols, cursor } = inputSchema.parse(args);
    const results = JSON.parse(
      JSON.stringify(apiReference().show(symbols)),
    ) as ApiReferenceShowResult[];
    const units = unitsOf(results);
    const start = decodeCursor(cursor, "api_show", { symbols }, units.length);
    // The largest prefix of the remaining units that still fits one page.
    let low = start;
    let high = units.length;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (fitsPage({ results: assemble(results, units.slice(start, middle)) })) low = middle;
      else high = middle - 1;
    }
    if (low === start && start < units.length) {
      throw resultTooLarge(
        "api_show",
        "A single symbol is larger than one page; request a narrower symbol such as a member.",
      );
    }
    const page = { results: assemble(results, units.slice(start, low)) };
    return {
      output:
        low < units.length
          ? { ...page, truncated: true, cursor: encodeCursor("api_show", { symbols }, low) }
          : page,
      repo: null,
    };
  },
};
