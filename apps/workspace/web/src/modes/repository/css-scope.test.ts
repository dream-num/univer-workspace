import { readdirSync, readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const repository = new URL("./", import.meta.url);
const scope = ':root[data-ui-mode="repository"]';

function cssParts(source: string) {
  const css = source.replace(/\/\*[\s\S]*?\*\//g, "");
  const parts: { header: string; body: string | null }[] = [];
  let depth = 0;
  let start = 0;
  let bodyStart = 0;
  for (const token of css.matchAll(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[{};]/g)) {
    if (token[0] === "{") {
      if (depth === 0) bodyStart = token.index + 1;
      depth++;
    } else if (token[0] === "}") {
      depth--;
      if (depth === 0) {
        parts.push({
          header: css.slice(start, bodyStart - 1).trim(),
          body: css.slice(bodyStart, token.index),
        });
        start = token.index + 1;
      }
    } else if (token[0] === ";" && depth === 0) {
      parts.push({ header: css.slice(start, token.index).trim(), body: null });
      start = token.index + 1;
    }
    if (depth < 0) throw new Error("Unexpected CSS closing brace");
  }
  if (depth !== 0 || css.slice(start).trim()) throw new Error("Unclosed CSS rule");
  return parts;
}

function isScoped(css: string) {
  return cssParts(css).every(({ header, body }) =>
    body === null ? /^@(import|layer)\s/.test(header) : header === scope,
  );
}

function rdNames(css: string) {
  return cssParts(css)
    .flatMap(({ header, body }) => body === null ? (header.match(/^(--rd-[\w-]+)\s*:/)?.[1] ?? []) : [])
    .sort();
}

describe("Repository CSS isolation", () => {
  it("keeps every stylesheet under the Repository root, including media queries", () => {
    const files = readdirSync(repository, { recursive: true, encoding: "utf8" })
      .filter((file) => file.endsWith(".css"));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      expect(isScoped(readFileSync(new URL(file, repository), "utf8")), file).toBe(true);
    }
  });

  it("rejects global selectors and at-rule blocks while allowing nested rules and statements", () => {
    expect(isScoped(`${scope} { @media (width < 720px) { .row { color: red; } } }`)).toBe(true);
    expect(isScoped(`@import "fonts.css"; @layer components; ${scope} { content: "};{"; }`)).toBe(true);
    expect(isScoped(`${scope} {} body { color: red; }`)).toBe(false);
    expect(isScoped(`@media (width < 720px) { ${scope} {} }`)).toBe(false);
    expect(isScoped('@font-face { font-family: "leak"; }')).toBe(false);
  });

  it("defines the same D tokens in light and dark", () => {
    const theme = cssParts(readFileSync(new URL("theme.css", repository), "utf8"));
    expect(theme).toHaveLength(1);
    const light = theme[0]?.body;
    expect(light).toBeTruthy();
    const dark = cssParts(light ?? "").find(({ header }) => header === "&.dark")?.body;
    expect(dark).toBeTruthy();
    expect(rdNames(light ?? "").length).toBeGreaterThan(0);
    expect(rdNames(dark ?? "")).toEqual(rdNames(light ?? ""));
  });
});

describe("Repository mode before first paint", () => {
  const html = readFileSync(new URL("../../../index.html", repository), "utf8");
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];

  it.each(["repository", "wiki", "invalid", null, "unavailable"])("validates stored mode %s", (stored) => {
    const document = { documentElement: { dataset: { uiMode: "" } } };
    expect(script).toBeTruthy();
    runInNewContext(script ?? "", {
      document,
      localStorage: {
        getItem(key: string) {
          if (stored === "unavailable") throw new Error("Storage unavailable");
          return key === "univer-workspace-layout-theme" ? stored : "light";
        },
      },
    });
    expect(document.documentElement.dataset.uiMode).toBe(stored === "wiki" ? "wiki" : "repository");
  });
});
