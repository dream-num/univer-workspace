/**
 * Last-resort report for failures no command translated. Node would otherwise print the throwing
 * source line, and a bundled SDK file is a single line of up to 100 KB of obfuscated code.
 */
export function reportFatalError(
  error: unknown,
  options: {
    readonly env: NodeJS.ProcessEnv;
    readonly writeError: (text: string) => void;
  },
): void {
  const summary = error instanceof Error ? error.message : String(error);
  const detail =
    options.env["UNIVER_DEBUG"] === "1" && error instanceof Error ? error.stack : undefined;
  options.writeError(`${detail ?? summary}\n`);
}
