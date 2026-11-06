import { describe, expect, it } from "vitest";
import { reportFatalError } from "../src/fatal-error.js";

function report(error: unknown, env: NodeJS.ProcessEnv = {}): string {
  const output: string[] = [];
  reportFatalError(error, { env, writeError: (text) => output.push(text) });
  return output.join("");
}

describe("fatal error report", () => {
  it("prints only the message of an untranslated error", () => {
    expect(report(new Error("DOC_MARKDOWN_READ_STALE_SOURCE_MAP: Refresh the map."))).toBe(
      "DOC_MARKDOWN_READ_STALE_SOURCE_MAP: Refresh the map.\n",
    );
  });

  it("prints a thrown non-Error value", () => {
    expect(report("plain failure")).toBe("plain failure\n");
  });

  it("prints the stack only when debugging is enabled", () => {
    const error = new Error("boom");
    expect(report(error, { UNIVER_DEBUG: "1" })).toBe(`${String(error.stack)}\n`);
    expect(report(error, { UNIVER_DEBUG: "0" })).toBe("boom\n");
  });
});
