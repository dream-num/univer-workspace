import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { expect, it } from "vitest";

const script = new URL("../skill-data/html-view/scripts/preview.mjs", import.meta.url);
const path = script.pathname;

it("is one file of at most 8 KB that imports only Node built-ins", async () => {
  const source = await readFile(script, "utf8");
  expect(Buffer.byteLength(source)).toBeLessThanOrEqual(8 * 1024);
  const specifiers = [...source.matchAll(/(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"]([^'"]+)['"]/g)].map((match) => match[1]);
  expect(specifiers.length).toBeGreaterThan(0);
  expect(specifiers.filter((specifier) => !specifier!.startsWith("node:"))).toEqual([]);
});

it("passes its own self-check for the token, Origin, Host and path rules", () => {
  expect(execFileSync(process.execPath, [path, "--self-check"], { encoding: "utf8" })).toContain("self-check ok");
});

it("prints ready, serves the file, takes a report and prints it, and reports waiting", async () => {
  const dir = await mkdtemp(join(tmpdir(), "preview-host-"));
  const page = join(dir, "page.univer.html");
  await writeFile(page, "<p>one</p>");
  const child = spawn(process.execPath, [path, page, "--workspace", "http://127.0.0.1:5999", "--wait", "1"], { stdio: ["ignore", "pipe", "inherit"] });
  const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  const next = async () => JSON.parse((await lines.next()).value as string) as Record<string, unknown>;
  try {
    const ready = await next();
    expect(ready).toMatchObject({ event: "ready", file: page, token: expect.stringMatching(/^t[0-9a-f]{32}$/) });
    const url = new URL(ready.url as string);
    expect(url.origin + url.pathname).toBe("http://127.0.0.1:5999/html-view-preview");
    const src = new URL(url.searchParams.get("src")!);
    expect(url.searchParams.get("token")).toBe(ready.token);
    const at = (route: string) => new URL(`${route}?token=${ready.token}`, src.origin).href;
    const origin = { Origin: "http://127.0.0.1:5999" };

    const served = await fetch(at("/page"), { headers: origin });
    expect(served.status).toBe(200);
    expect(await served.text()).toBe("<p>one</p>");
    const refused = await fetch(new URL("/page", src.origin), { headers: origin });
    expect(refused.status).toBe(403);
    expect(refused.headers.get("access-control-allow-origin")).toBe("http://127.0.0.1:5999");
    expect((await fetch(at("/page"), { headers: { Origin: "https://evil.example" } })).status).toBe(403);
    expect((await fetch(at("/" + page.split("/").pop()), { headers: origin })).status).toBe(404);
    expect((await fetch(at("/report"))).status).toBe(204);

    const report = { token: ready.token, sha256: "a".repeat(64), writeMode: "trial" };
    expect((await fetch(at("/report"), { method: "POST", headers: origin, body: JSON.stringify(report) })).status).toBe(204);
    expect(await next()).toEqual({ event: "report", ...report });
    expect(await (await fetch(at("/report"))).json()).toEqual(report);
    expect((await fetch(at("/report"), { method: "POST", headers: origin, body: "{" })).status).toBe(400);
  } finally {
    child.kill();
  }
});

it("prints waiting when no browser connects in time", async () => {
  const dir = await mkdtemp(join(tmpdir(), "preview-host-"));
  const page = join(dir, "page.univer.html");
  await writeFile(page, "<p>one</p>");
  const child = spawn(process.execPath, [path, page, "--wait", "1"], { stdio: ["ignore", "pipe", "inherit"] });
  const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  try {
    expect(JSON.parse((await lines.next()).value as string).event).toBe("ready");
    expect(JSON.parse((await lines.next()).value as string)).toEqual({ event: "waiting", seconds: 1 });
  } finally {
    child.kill();
  }
});

it("carries the pull-request source into the preview URL and rejects half of it", async () => {
  const dir = await mkdtemp(join(tmpdir(), "preview-host-"));
  const page = join(dir, "page.univer.html");
  await writeFile(page, "<p>one</p>");
  const child = spawn(process.execPath, [path, page, "--repo", "owner/repo", "--pr", "12", "--wait", "0"], { stdio: ["ignore", "pipe", "inherit"] });
  const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  try {
    const url = new URL(JSON.parse((await lines.next()).value as string).url as string);
    expect(url.searchParams.get("repo")).toBe("owner/repo");
    expect(url.searchParams.get("pr")).toBe("12");
  } finally {
    child.kill();
  }
  expect(() => execFileSync(process.execPath, [path, page, "--repo", "owner/repo"], { stdio: "pipe" })).toThrow(/--repo <owner\/slug> --pr <n>/);
});
