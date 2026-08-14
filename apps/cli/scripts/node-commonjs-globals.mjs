export function injectNodeCommonjsGlobals(code) {
  const missingRequireMessage = "environment that doesn't expose the `require` function";
  const needsRequire =
    code.includes(missingRequireMessage) &&
    !/\b(?:const|let|var)\s+require\s*=\s*[^;\n]*[Cc]reateRequire/u.test(code);
  const needsFilename =
    code.includes("__filename") && !/\b(?:const|let|var)\s+__filename\b/u.test(code);
  const needsDirname =
    code.includes("__dirname") && !/\b(?:const|let|var)\s+__dirname\b/u.test(code);
  if (!needsRequire && !needsFilename && !needsDirname) return undefined;

  const imports = [
    ...(needsRequire
      ? ['import { createRequire as __univerCreateRequire } from "node:module";']
      : []),
    ...(needsFilename || needsDirname
      ? [
          'import { dirname as __univerPathDirname } from "node:path";',
          'import { fileURLToPath as __univerFileURLToPath } from "node:url";',
        ]
      : []),
  ];
  const declarations = [
    ...(needsRequire ? ["const require = __univerCreateRequire(import.meta.url);"] : []),
    ...(needsFilename || needsDirname
      ? ["const __filename = __univerFileURLToPath(import.meta.url);"]
      : []),
    ...(needsDirname ? ["const __dirname = __univerPathDirname(__filename);"] : []),
  ];
  const importPrefix = code.match(/^(?:import[\s\S]*?;\n)*/u)?.[0] ?? "";
  return `${importPrefix}${imports.join("\n")}\n${declarations.join("\n")}\n${code.slice(importPrefix.length)}`;
}
