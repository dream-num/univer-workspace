import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createDaemonClient,
  createDaemonServer,
  type DaemonClient,
  type JsonValue,
} from "@univer-cli/daemon";
import type {
  SheetLensResult,
  WorkspaceRuntimeScope,
  WorkspaceRuntimeTarget,
} from "@univerjs/univer-workspace-client-core";
import { LocaleType, type IWorkbookData } from "@univerjs/core";
import { Command } from "commander";
import { describe, expect, it, vi } from "vitest";
import {
  createSheetLensCommands,
  type SheetLensInput,
} from "../src/features/sheet-lens/command.js";
import { createSheetLensHandler } from "../src/runtime/sheet-lens.js";

const result: SheetLensResult = {
  text: "body",
  json: { cells: [] },
  revision: 7,
  warnings: [{ code: "sheet-lens-not-cached", message: "a warning" }],
  timings: { totalMs: 1 },
  cache: "miss",
};
const target: WorkspaceRuntimeTarget = {
  origin: "https://workspace.test",
  unitId: "book-1",
  unitType: "sheet",
  scope: { kind: "trunk" },
  revision: 7,
};

function programWith(run: (input: SheetLensInput) => Promise<SheetLensResult>) {
  const stdout: string[] = [],
    stderr: string[] = [];
  const program = new Command("uvw").exitOverride();
  program.configureOutput({
    writeOut: (text) => stdout.push(text),
    writeErr: (text) => stderr.push(text),
  });
  for (const command of createSheetLensCommands({ run })) {
    command.configureOutput(program.configureOutput()).exitOverride();
    program.addCommand(command);
  }
  return { program, stdout, stderr };
}

function shellArgs(command: string): string[] {
  const output = execFileSync("/bin/sh", ["-c", `uvw() { printf '%s\\0' "$@"; }; ${command}`], {
    encoding: "utf8",
  });
  return output.split("\0").slice(0, -1);
}

describe("Sheet Lens commands", () => {
  it.each(["outline", "read", "find"])("%s help states Sheet only", async (name) => {
    const { program, stdout } = programWith(vi.fn());
    await expect(program.parseAsync([name, "--help"], { from: "user" })).rejects.toMatchObject({
      exitCode: 0,
    });
    expect(stdout.join("")).toContain("Sheet only; use inspect for Doc, Slide, Base and Board");
  });

  const pages = [
    {
      args: ["outline", "--at", "s1", "--from", "s1.t1", "--depth", "2", "--budget", "250"],
      next: { op: "outline", at: "s1", from: "s1.t3", remaining: 3, unit: "regions" },
      request: { op: "outline", at: "s1", from: "s1.t3", depth: 2, budget: 250 },
    },
    {
      args: ["read", "'Sales O''Brien'!A1:C5", "--formulas", "--styles", "--max", "3"],
      next: { op: "read", range: "'Sales O''Brien'!A2:C5", remaining: 4 },
      request: { op: "read", range: "'Sales O''Brien'!A2:C5", content: "formula+style", max: 3 },
    },
    {
      args: ["read", "Sales!A1:C5", "--values", "--max", "3"],
      next: { op: "read", range: "Sales!A2:C5", remaining: 4 },
      request: { op: "read", range: "Sales!A2:C5", content: "display", max: 3 },
    },
    {
      args: [
        "find",
        "O'Brien",
        "$(false)",
        "--in",
        "formulas",
        "--case",
        "--sheet",
        "Sales O'Brien",
        "--sheet",
        "Other sheet",
        "--from",
        "s1!A1",
        "--max",
        "1",
      ],
      next: { op: "find", from: "'Sales O''Brien'!B3", remaining: 2 },
      request: {
        op: "find",
        terms: ["O'Brien", "$(false)"],
        in: "formulas",
        caseSensitive: true,
        sheets: ["Sales O'Brien", "Other sheet"],
        from: "'Sales O''Brien'!B3",
        max: 1,
      },
    },
  ] satisfies {
    args: string[];
    next: NonNullable<SheetLensResult["next"]>;
    request: SheetLensInput["request"];
  }[];

  for (const scopeArgs of [["--trunk"], ["--worktree", "wt O'Brien"]]) {
    it.each(pages)(
      `continuations execute with preserved options (${scopeArgs[0]}) $args.0`,
      async ({ args, next, request }) => {
        const run = vi.fn(async () => ({ ...result, next }));
        const { program, stdout } = programWith(run);
        await program.parseAsync([...args, "--unit", "book O'Brien", ...scopeArgs, "--json"], {
          from: "user",
        });
        const json = JSON.parse(stdout.join(""));
        const scope: WorkspaceRuntimeScope =
          scopeArgs[0] === "--trunk"
            ? { kind: "trunk" }
            : { kind: "worktree", worktreeId: "wt O'Brien" };
        expect(json).toEqual({
          unitId: "book O'Brien",
          scope,
          revision: 7,
          text: "body",
          json: { cells: [] },
          warnings: result.warnings,
          next: expect.any(String),
        });
        const continued = programWith(run);
        await continued.program.parseAsync(shellArgs(json.next), { from: "user" });
        expect(run).toHaveBeenLastCalledWith({ unitId: "book O'Brien", scope, request });
        expect(JSON.parse(continued.stdout.join(""))).toHaveProperty("revision", 7);
        if (args.includes("--values")) expect(shellArgs(json.next)).toContain("--values");
        if (args.includes("--styles")) expect(shellArgs(json.next)).toContain("--styles");
      },
    );
  }

  it("prints revision, body, warnings and the runnable footer in order", async () => {
    const next = { op: "find", from: "Sheet1!B2", remaining: 2 } as const;
    const { program, stdout } = programWith(async () => ({ ...result, text: "body\n\n", next }));
    await program.parseAsync(["find", "needle", "--unit", "book-1", "--trunk", "--max", "1"], {
      from: "user",
    });
    const lines = stdout.join("").trimEnd().split("\n");
    expect(lines.slice(0, 3)).toEqual(["unit book-1 [trunk, rev=7]", "body", "note: a warning"]);
    expect(lines[3]).toMatch(/^… 2 more hits: uvw find /);
    const command = lines[3]?.split("more hits: ")[1];
    expect(command).toBeDefined();
    expect(shellArgs(command ?? "")).toContain("Sheet1!B2");
  });

  it("stamps a worktree read with its scope and revision", async () => {
    const { program, stdout } = programWith(async () => result);
    await program.parseAsync(["outline", "--unit", "book-1", "--worktree", "wt-1"], {
      from: "user",
    });
    expect(stdout.join("").split("\n")[0]).toBe("unit book-1 [worktree wt-1, rev=7]");
  });

  it("preserves engine trailing newlines in JSON text", async () => {
    const { program, stdout } = programWith(async () => ({ ...result, text: "body\n\n" }));
    await program.parseAsync(["outline", "--unit", "book-1", "--trunk", "--json"], {
      from: "user",
    });
    expect(JSON.parse(stdout.join("")).text).toBe("body\n\n");
  });

  it("omits next when complete and never exposes cache or timings", async () => {
    const { program, stdout } = programWith(async () => result);
    await program.parseAsync(["outline", "--unit", "book-1", "--worktree", "wt-1", "--json"], {
      from: "user",
    });
    expect(Object.keys(JSON.parse(stdout.join(""))).sort()).toEqual(
      ["unitId", "scope", "revision", "text", "json", "warnings"].sort(),
    );
  });

  it.each([
    ["outline", "--depth", "3"],
    ["outline", "--budget", "0"],
    ["read", "A1", "--max", "-1"],
    ["read", "A1", "--values", "--formulas"],
    ["find", "x", "--in", "styles"],
    ["find", "x", "--max", "1.5"],
    ["outline", "--trunk", "--worktree", "wt"],
  ])("rejects invalid options %j", async (...args) => {
    const run = vi.fn();
    const { program } = programWith(run);
    await expect(
      program.parseAsync([...args, "--unit", "book-1"], { from: "user" }),
    ).rejects.toThrow();
    expect(run).not.toHaveBeenCalled();
  });

  it("requires an explicit scope before running", async () => {
    const run = vi.fn();
    const { program } = programWith(run);
    await expect(
      program.parseAsync(["outline", "--unit", "book-1"], { from: "user" }),
    ).rejects.toMatchObject({ exitCode: 1 });
    expect(run).not.toHaveBeenCalled();
  });
});

async function withDaemon(
  test: (input: {
    client: DaemonClient;
    sessionPath: string;
    data: IWorkbookData;
    exportUnitData: ReturnType<typeof vi.fn>;
  }) => Promise<void>,
) {
  const directory = await mkdtemp(join(tmpdir(), "uvw-lens-"));
  const sessionPath = join(directory, "session.json");
  const data: IWorkbookData = {
    id: "book-1",
    name: "Sales",
    appVersion: "1",
    locale: LocaleType.EN_US,
    styles: {},
    sheetOrder: ["s1"],
    sheets: {
      s1: {
        id: "s1",
        name: "Sales",
        rowCount: 20,
        columnCount: 3,
        cellData: {
          0: { 0: { v: "Item" }, 1: { v: "Total" } },
          1: { 0: { v: "Apple" }, 1: { v: 2 } },
        },
      },
    },
  };
  const exportUnitData = vi.fn(async () => data);
  const identity = { id: "uvw-sheet-lens-test", version: "1" };
  const socketPath = join(directory, "d.sock");
  const server = createDaemonServer({ identity, socketPath });
  server.handle(
    "sheet-lens.run",
    createSheetLensHandler({ runtime: { exportUnitData }, sessionPath }),
  );
  const client = createDaemonClient({ identity, socketPath, entry: new URL(import.meta.url) });
  try {
    await writeSession(sessionPath, "alice");
    await server.listen();
    await test({ client, sessionPath, data, exportUnitData });
  } finally {
    await server.close();
    await rm(directory, { recursive: true, force: true });
  }
}

async function writeSession(path: string, subject: string) {
  await writeFile(
    path,
    JSON.stringify({
      sessions: { [target.origin]: { cookie: `workspace_session=${subject}`, subject } },
    }),
  );
}

describe("Sheet Lens daemon RPC", () => {
  it("fully detects a sparse 520,000-cell box and limits one above 750,000", async () => {
    await withDaemon(async ({ client, data }) => {
      const sheet = data.sheets["s1"];
      if (!sheet) throw new Error("missing test sheet");
      sheet.rowCount = 30000;
      sheet.columnCount = 26;
      sheet.cellData = {
        0: { 0: { v: "start" } },
        19999: { 25: { v: 1 } },
      };
      const payload = { target, request: { op: "outline", at: "s1", depth: 2 } } satisfies JsonValue;
      const below = await client.request("sheet-lens.run", payload);
      expect(below).toMatchObject({ warnings: [], cache: "miss" });
      expect(await client.request("sheet-lens.run", payload)).toMatchObject({ cache: "hit" });
      sheet.cellData = {
        0: { 0: { v: "start" } },
        28846: { 25: { v: 1 } },
      };
      const above = await client.request("sheet-lens.run", {
        ...payload,
        target: { ...target, revision: 8 },
      });
      expect(above).toMatchObject({
        warnings: [expect.objectContaining({ code: "sheet-lens-sheet-too-large" })],
        text: expect.stringContaining("block"),
      });
    });
  });

  it("resolves legacy session subjects once per origin and cookie", async () => {
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      const cookie = new Request(input, init).headers.get("cookie");
      return Response.json({ authenticated: true, user: { id: cookie, displayName: "Lens user" } });
    });
    vi.stubGlobal("fetch", fetcher);
    try {
      await withDaemon(async ({ client, sessionPath }) => {
        const payload = { target, request: { op: "outline" } } satisfies JsonValue;
        const legacySession = async (cookie: string, origins = [target.origin]) =>
          writeFile(
            sessionPath,
            JSON.stringify({
              sessions: Object.fromEntries(origins.map((origin) => [origin, { cookie }])),
            }),
          );
        await legacySession("workspace_session=alice");
        expect(await client.request("sheet-lens.run", payload)).toMatchObject({ cache: "miss" });
        expect(await client.request("sheet-lens.run", payload)).toMatchObject({ cache: "hit" });
        expect(fetcher).toHaveBeenCalledTimes(1);
        await legacySession("workspace_session=bob");
        expect(await client.request("sheet-lens.run", payload)).toMatchObject({ cache: "miss" });
        expect(await client.request("sheet-lens.run", payload)).toMatchObject({ cache: "hit" });
        expect(fetcher).toHaveBeenCalledTimes(2);
        const otherOrigin = "https://other.test";
        await legacySession("workspace_session=bob", [target.origin, otherOrigin]);
        await client.request("sheet-lens.run", {
          ...payload,
          target: { ...target, origin: otherOrigin },
        });
        expect(fetcher).toHaveBeenCalledTimes(3);
        await legacySession("workspace_session=alice");
        expect(await client.request("sheet-lens.run", payload)).toMatchObject({ cache: "hit" });
        expect(fetcher).toHaveBeenCalledTimes(3);
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("reuses its engine by revision and isolates the user read from the credential session", async () => {
    await withDaemon(async ({ client, sessionPath, exportUnitData }) => {
      const payload = { target, request: { op: "outline" } } satisfies JsonValue;
      expect(await client.request("sheet-lens.run", payload)).toMatchObject({
        cache: "miss",
        revision: 7,
      });
      expect(await client.request("sheet-lens.run", payload)).toMatchObject({
        cache: "hit",
        revision: 7,
      });
      await writeSession(sessionPath, "bob");
      expect(await client.request("sheet-lens.run", payload)).toMatchObject({ cache: "miss" });
      expect(exportUnitData.mock.calls).toEqual([[{ target }], [{ target }]]);
      expect(
        await client.request("sheet-lens.run", { ...payload, target: { ...target, revision: 8 } }),
      ).toMatchObject({ cache: "miss", revision: 8 });
    });
  });

  it("labels read continuations with the remaining row count from the engine", async () => {
    await withDaemon(async ({ client }) => {
      const run = async ({ request }: SheetLensInput) =>
        (await client.request("sheet-lens.run", { target, request })) as unknown as SheetLensResult;
      const { program, stdout } = programWith(run);
      await program.parseAsync(
        ["read", "Sales!A1:B2", "--max", "2", "--unit", "book-1", "--trunk"],
        { from: "user" },
      );
      const footer = stdout.join("").trimEnd().split("\n").at(-1) ?? "";
      expect(footer).toMatch(/^… 1 more rows: uvw read /);
      const continued = programWith(run);
      await continued.program.parseAsync(shellArgs(footer.split("more rows: ")[1] ?? ""), {
        from: "user",
      });
      expect(continued.stdout.join("")).toContain("Apple");
      expect(continued.stdout.join("")).not.toContain("… ");
    });
  });

  it("prints the actual Lens error code and hint after daemon transport, with nonzero exit", async () => {
    await withDaemon(async ({ client }) => {
      const { program, stderr } = programWith(
        async ({ request }) =>
          (await client.request("sheet-lens.run", {
            target,
            request,
          })) as unknown as SheetLensResult,
      );
      await expect(
        program.parseAsync(["outline", "--at", "s9.t99", "--unit", "book-1", "--trunk"], {
          from: "user",
        }),
      ).rejects.toMatchObject({ exitCode: 1 });
      expect(stderr.join("")).toContain("workspace-sheet-lens-ref-not-found");
      expect(stderr.join("")).toContain("Hint: run outline on this Unit again");
    });
  });

  it("rejects malformed RPC input and non-Sheets before exporting", async () => {
    await withDaemon(async ({ client, exportUnitData }) => {
      for (const request of [
        { op: "read", range: "A1", content: "wrong" },
        { op: "find", terms: [1], in: "values", caseSensitive: false },
        { op: "outline", depth: 3 },
      ]) {
        await expect(client.request("sheet-lens.run", { target, request })).rejects.toMatchObject({
          code: "workspace-argument-invalid",
        });
      }
      await expect(
        client.request("sheet-lens.run", {
          target: { ...target, unitType: "doc" },
          request: { op: "outline" },
        }),
      ).rejects.toMatchObject({
        code: "workspace-sheet-lens-unit-type-unsupported",
        message: expect.stringContaining("inspect"),
      });
      expect(exportUnitData).not.toHaveBeenCalled();
    });
  });
});
