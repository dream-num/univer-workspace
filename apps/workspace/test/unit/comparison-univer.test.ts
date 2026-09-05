import { FUniver } from "@univerjs/core/facade";
import { LocaleType, LogLevel } from "@univerjs/core";
import { defaultTheme } from "@univerjs/themes";
import { describe, expect, it } from "vitest";

describe("comparison Univer runtime", () => {
  it("registers Facade dependencies before an API is created", async () => {
    Object.defineProperty(globalThis, "Path2D", {
      configurable: true,
      value: class Path2D {},
    });
    const { createComparisonUniverRuntime } = await import(
      "../../web/src/features/editor/comparison-univer.js"
    );
    const univer = createComparisonUniverRuntime({
      darkMode: false,
      locale: LocaleType.EN_US,
      locales: {},
      logLevel: LogLevel.WARN,
      presets: [],
      theme: defaultTheme,
    });

    try {
      expect(() => FUniver.newAPI(univer)).not.toThrow();
    } finally {
      univer.dispose();
    }
  }, 20_000);
});
