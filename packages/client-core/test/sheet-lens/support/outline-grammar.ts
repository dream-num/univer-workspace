// Ported from dream-num/unvdp@23446146d48cb948a61bef1f0a31ad0ef75a537d, packages/unvdp-core/protocol/tools/outline-grammar.ts
// (reference implementation, read-only). Tests of Lens.read are left out until `uxl read` (#19); expectations were adapted to uxl's
// outline (sheet counts, SheetLensError messages). Everything else is as in the reference.
// Reference tokenizer for the outline line grammar (rfcs/0001-unvdp/04-lens-outline.md section 2).
// `pnpm unvdp:grammar [file...]` parses every outline line in the spec's code blocks (and in the given files) and
// fails on the first line the grammar cannot split unambiguously. It is the executable form of section 2.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const KINDS = new Set([
  "workbook",
  "sheet",
  "table",
  "matrix",
  "form",
  "text",
  "kpi",
  "block",
  "col",
  "axis",
  "field",
  "obj",
  "objects",
]);
const OBJTYPES = new Set([
  "cf",
  "dv",
  "table",
  "filter",
  "name",
  "chart",
  "image",
  "shape",
  "pivot",
]);

export interface ParsedLine {
  depth: number;
  kind: string;
  objtype?: string;
  name?: string;
  attrs?: string[][];
  value?: string;
  elision?: { count: number; noun: string; zoom: string; from: string; range?: string };
}

function readJsonString(s: string, i: number): [string, number] {
  let j = i + 1;
  while (j < s.length) {
    if (s[j] === "\\") {
      j += 2;
      continue;
    }
    if (s[j] === '"') return [JSON.parse(s.slice(i, j + 1)), j + 1];
    j++;
  }
  throw new Error("unterminated JSON string");
}

export function parseLine(line: string): ParsedLine {
  const m = /^( *)- /.exec(line);
  if (!m || m[1]!.length % 2) throw new Error("bad indent");
  const depth = m[1]!.length / 2;
  let i = m[0].length;
  if (line.startsWith("… ", i)) {
    const e =
      /^… (\d+) more ([a-z]+) \[zoom=([^\],\s]+), from=([^\],\s]+)(?:, range=([A-Z]+\d+(?::[A-Z]+\d+)?))?\]$/.exec(
        line.slice(i),
      );
    if (!e) throw new Error("bad elision line");
    return {
      depth,
      kind: "elision",
      elision: {
        count: Number(e[1]),
        noun: e[2] as string,
        zoom: e[3] as string,
        from: e[4] as string,
        ...(e[5] ? { range: e[5] } : {}),
      },
    };
  }
  const k = /^[a-z]+/.exec(line.slice(i));
  if (!k || !KINDS.has(k[0] as string)) throw new Error(`unknown kind ${k?.[0]}`);
  const out: ParsedLine = { depth, kind: k[0] as string };
  i += k[0].length;
  if (out.kind === "obj") {
    const o = /^ ([a-z]+)/.exec(line.slice(i));
    if (!o || !OBJTYPES.has(o[1] as string)) throw new Error("unknown objtype");
    out.objtype = o[1] as string;
    i += o[0].length;
  }
  if (line.startsWith(' "', i)) [out.name, i] = readJsonString(line, i + 1);
  if (line.startsWith(" [", i)) {
    i += 2;
    const attrs: string[][] = [];
    let cur: string[] = [];
    let tok = "";
    for (;;) {
      if (i >= line.length) throw new Error("unclosed [");
      const c = line[i];
      if (c === '"') {
        const [v, j] = readJsonString(line, i);
        tok += JSON.stringify(v);
        i = j;
        continue;
      }
      if (c === "]") {
        if (tok) cur.push(tok);
        attrs.push(cur);
        i++;
        break;
      }
      if (line.startsWith(", ", i)) {
        if (tok) cur.push(tok);
        attrs.push(cur);
        cur = [];
        tok = "";
        i += 2;
        continue;
      }
      if (c === " ") {
        if (tok) cur.push(tok);
        tok = "";
        i++;
        continue;
      }
      if (c === "[") throw new Error("bare [ inside attributes");
      tok += c;
      i++;
    }
    out.attrs = attrs;
  }
  if (line.startsWith(": ", i)) {
    out.value = line.slice(i + 2);
    i = line.length;
  }
  if (i !== line.length) throw new Error(`unparsed text: ${JSON.stringify(line.slice(i, i + 30))}`);
  return out;
}

function outlineLines(text: string, onlyCodeBlocks: boolean): string[] {
  const src = onlyCodeBlocks
    ? [...text.matchAll(/```text\n([\s\S]*?)```/g)].map((m) => m[1]).join("\n")
    : text;
  return src.split("\n").filter((l) => /^ *- /.test(l));
}

if (process.argv[1]?.endsWith("outline-grammar.ts")) {
  const spec = new URL("../04-lens-outline.md", import.meta.url).pathname;
  const inputs: [string, boolean][] = [
    [spec, true],
    ...process.argv
      .slice(2)
      .filter((a) => a !== "--")
      .map((f): [string, boolean] => [f, false]),
  ];
  let n = 0;
  for (const [file, codeOnly] of inputs) {
    for (const line of outlineLines(readFileSync(file, "utf8"), codeOnly)) {
      try {
        parseLine(line);
        n++;
      } catch (err) {
        assert.fail(`${file}: ${(err as Error).message}\n  ${line}`);
      }
    }
  }
  // the tricky cases called out in section 2
  const p = parseLine(
    '    - col "Region" [ref=s1.t1.c2, B, text, 4 distinct: East|West|North|South]',
  );
  assert.deepEqual(
    p.attrs?.at(-1),
    ["4", "distinct:", "East|West|North|South"],
    'a ": " inside brackets is not the value',
  );
  const q = parseLine(
    '  - kpi "Total" [ref=s1.k1, J10, number "#,##0.00", f=SUM(E4:E1202)]: 1,284,330.50',
  );
  assert.equal(q.value, "1,284,330.50", 'the value follows "]: "');
  console.log(`outline grammar OK (${n} lines)`);
}
