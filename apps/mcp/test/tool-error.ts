import type { Client } from "@modelcontextprotocol/client";
import { expect } from "vitest";
import { z } from "zod";

export function toolError(result: Awaited<ReturnType<Client["callTool"]>>) {
  expect(result.isError).toBe(true);
  expect(result.structuredContent).toBeUndefined();
  const text = z.object({ type: z.literal("text"), text: z.string() }).parse(
    z.array(z.unknown()).parse(result.content)[0],
  );
  return z.object({ code: z.string(), message: z.string(), detail: z.unknown().optional() })
    .parse(JSON.parse(text.text));
}
