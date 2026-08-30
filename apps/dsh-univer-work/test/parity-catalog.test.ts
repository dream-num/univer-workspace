import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context } from "@deepseek-ai/cordis";
import LocalFileSystem from "@deepseek-ai/dsh-fs-local";
import { CallId } from "@deepseek-ai/dsh-llm";
import { Session, SessionId } from "@deepseek-ai/dsh-session";
import SkillRegistry from "@deepseek-ai/dsh-skill";
import SystemPrompt from "@deepseek-ai/dsh-system-prompt";
import ToolRuntime from "@deepseek-ai/dsh-tools";
import ApprovalService, { type ApprovalOutcome } from "@deepseek-ai/dsh-user-approval";
import { describe, expect, it } from "vitest";
import { apply, inject, name } from "../src/index.js";
import { mountWorkspaceAuthentication } from "../src/authentication.js";
import { PARITY_MANIFEST } from "../src/parity-manifest.js";

type CatalogSnapshot = {
  tools: Array<{
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    output: unknown;
  }>;
  skills: Array<{
    name: string;
    description: string;
    invocation: { modelInvocable: boolean; userInvocable: boolean };
    provider: string;
    source: string;
  }>;
};

describe("complete Workspace parity catalog", () => {
  it("matches one canonical real-registry snapshot and removes every contribution on dispose", async () => {
    const fixture = await setupCatalog();
    try {
      const snapshot = await readCatalog(fixture.ctx, fixture.cwd);
      validateCatalog(snapshot);
      await expect(JSON.stringify(snapshot, null, 2)).toMatchFileSnapshot(
        "./snapshots/parity-registry.json",
      );

      const mutations: readonly [string, (value: CatalogSnapshot) => void][] = [
        ["missing", (value) => { value.tools.pop(); }],
        ["extra", (value) => { value.tools.push({ ...value.tools[0]!, name: "workspace_extra" }); }],
        ["renamed", (value) => { value.tools[0]!.name = "workspace_renamed"; }],
        ["duplicate", (value) => { value.tools[1]!.name = value.tools[0]!.name; }],
        ["open schema", (value) => { value.tools[0]!.output = { type: "object", additionalProperties: true }; }],
        ["invalid Skill", (value) => { value.skills[0]!.name = "missing-skill"; }],
      ];
      for (const [drift, mutate] of mutations) {
        const changed = structuredClone(snapshot);
        mutate(changed);
        expect(() => validateCatalog(changed), drift).toThrow();
      }

      await fixture.fiber.dispose();
      expect(fixture.ctx.tools.schemas()).toEqual([]);
      expect(await fixture.ctx.skills.list({ cwd: fixture.cwd })).toEqual([]);
    } finally {
      await fixture.ctx.fiber.dispose();
      await rm(fixture.cwd, { force: true, recursive: true });
    }
  });

  it("rejects a real registry contribution that shadows a package Skill", async () => {
    const fixture = await setupCatalog(true);
    try {
      const snapshot = await readCatalog(fixture.ctx, fixture.cwd);
      expect(snapshot.skills.find(({ name }) => name === "core")).toMatchObject({
        description: "Shadowed core Skill",
        source: "project-dsh",
      });
      expect(() => validateCatalog(snapshot)).toThrow("invalid Skill summary: core");
    } finally {
      await fixture.ctx.fiber.dispose();
      await rm(fixture.cwd, { force: true, recursive: true });
    }
  });

  it("joins every tool to the manifest and probes validation, approval denial, allowance, or delegation", async () => {
    const fixture = await setupPolicyProbe("rejected");
    try {
      const policies = operationPolicies();
      for (const schema of fixture.ctx.tools.schemas()) {
        const definition = fixture.ctx.tools.get(schema.name);
        if (definition === undefined) throw new Error(`missing tool definition: ${schema.name}`);
        const arguments_ = probeArguments(schema.name, definition.parameters, fixture.cwd);
        const beforeInvalid = fixture.approvals.length;
        const effectsBeforeInvalid = fixture.effects();
        const filesBeforeInvalid = await readdir(fixture.cwd, { recursive: true });
        const invalid = await fixture.ctx.tools.execute({
          agent: fixture.agent as never,
          arguments: { ...(arguments_ as Record<string, unknown>), unexpected: true },
          callId: CallId(`invalid-${schema.name}`),
          name: schema.name,
          signal: new AbortController().signal,
        });
        expect(invalid.isError, `${schema.name} invalid`).toBe(true);
        expect(fixture.approvals, `${schema.name} validates before approval`).toHaveLength(beforeInvalid);
        expect(fixture.effects(), `${schema.name} validates before dependency effects`).toEqual(effectsBeforeInvalid);
        expect(await readdir(fixture.cwd, { recursive: true }), `${schema.name} validates before files`).toEqual(
          filesBeforeInvalid,
        );

        const before = fixture.approvals.length;
        const result = await fixture.ctx.tools.execute({
          agent: fixture.agent as never,
          arguments: arguments_,
          callId: CallId(`probe-${schema.name}`),
          name: schema.name,
          signal: new AbortController().signal,
        });
        const policy = policies.get(schema.name);
        if (policy === undefined) throw new Error(`missing parity policy: ${schema.name}`);
        if (policy === "none") {
          expect(fixture.approvals, `${schema.name} delegates`).toHaveLength(before);
        } else {
          expect(result.isError, `${schema.name} denied`).toBe(true);
          expect(
            fixture.approvals.slice(before),
            `${schema.name} asks: ${JSON.stringify(result)}`,
          ).toEqual([schema.name]);
        }
      }
    } finally {
      await fixture.ctx.fiber.dispose();
      await rm(fixture.cwd, { force: true, recursive: true });
    }

    const allowed = await setupPolicyProbe("allowed-once");
    try {
      const policies = operationPolicies();
      for (const schema of allowed.ctx.tools.schemas()) {
        if (policies.get(schema.name) === "none") continue;
        const definition = allowed.ctx.tools.get(schema.name);
        if (definition === undefined) throw new Error(`missing tool definition: ${schema.name}`);
        const arguments_ = probeArguments(schema.name, definition.parameters, allowed.cwd);
        const approvalStart = allowed.approvals.length;
        const effectsBefore = allowed.effects();
        const filesBefore = await readdir(allowed.cwd, { recursive: true });
        const result = await allowed.ctx.tools.execute({
          agent: allowed.agent as never,
          arguments: arguments_,
          callId: CallId(`allowed-${schema.name}`),
          name: schema.name,
          signal: new AbortController().signal,
        });
        const filesAfter = await readdir(allowed.cwd, { recursive: true });
        const projectedResult = JSON.stringify(result);
        expect(allowed.approvals.slice(approvalStart), `${schema.name} allowed once`).toEqual([schema.name]);
        expect(
          JSON.stringify(allowed.effects()) !== JSON.stringify(effectsBefore)
            || JSON.stringify(filesAfter) !== JSON.stringify(filesBefore)
            || (schema.name === "workspace_resource_export"
              && projectedResult.includes('"code":"resource-not-found"')),
          `${schema.name} entered its accepted body: ${projectedResult}`,
        ).toBe(true);
        expect(projectedResult, `${schema.name} accepted result`).not.toContain("approval-denied");
      }
    } finally {
      await allowed.ctx.fiber.dispose();
      await rm(allowed.cwd, { force: true, recursive: true });
    }
  });
});

async function setupCatalog(shadowCore = false): Promise<{
  ctx: Context;
  cwd: string;
  fiber: { dispose(): Promise<void> };
}> {
  const cwd = await mkdtemp(join(tmpdir(), "dsh-parity-catalog-"));
  const ctx = new Context();
  await ctx.plugin(SystemPrompt);
  await ctx.plugin(ToolRuntime);
  await ctx.plugin(SkillRegistry);
  await ctx.plugin(LocalFileSystem, { cwd });
  ctx.provide("credentials", {} as Context["credentials"]);
  if (shadowCore) {
    ctx.skills.register({
      name: "core",
      description: "Shadowed core Skill",
      source: "project-dsh",
      content: "shadowed",
    });
  }
  const fiber = ctx.plugin({ name, inject, apply });
  await fiber;
  return { ctx, cwd, fiber };
}

async function readCatalog(ctx: Context, cwd: string): Promise<CatalogSnapshot> {
  const tools = ctx.tools.schemas().map((schema) => {
    const definition = ctx.tools.get(schema.name);
    if (definition === undefined) throw new Error(`missing registered tool: ${schema.name}`);
    return {
      name: schema.name,
      description: schema.description,
      parameters: schema.parameters,
      output: definition.output.schema,
    };
  }).sort((left, right) => left.name.localeCompare(right.name));
  const skills = (await ctx.skills.list({ cwd })).map((skill) => ({
    name: skill.name,
    description: skill.description,
    invocation: skill.invocation,
    provider: skill.provider,
    source: skill.source,
  })).sort((left, right) => left.name.localeCompare(right.name));
  return JSON.parse(JSON.stringify({ tools, skills })) as CatalogSnapshot;
}

async function setupPolicyProbe(outcome: ApprovalOutcome): Promise<{
  agent: { session: Session };
  approvals: string[];
  ctx: Context;
  cwd: string;
  effects: () => { credentials: number; heavyRuntime: number; http: number };
}> {
  const cwd = await mkdtemp(join(tmpdir(), "dsh-parity-policy-"));
  await mkdir(join(cwd, "bundle", "pages"), { recursive: true });
  await writeFile(join(cwd, "bundle", "typst.json"), JSON.stringify({
    pages: ["pages/one.typ"],
    schemaVersion: 1,
    targetUnitId: "doc-1",
    title: "Parity",
  }));
  await writeFile(join(cwd, "bundle", "pages", "one.typ"), "= Parity");
  await writeFile(join(cwd, "source.bin"), "fixture");
  await writeFile(join(cwd, "source.xlsx"), "fixture");
  await writeFile(join(cwd, "source.svg"), '<svg viewBox="0 0 100 100"><rect width="10" height="10"/></svg>');
  const ctx = new Context();
  await ctx.plugin(SystemPrompt);
  await ctx.plugin(ToolRuntime);
  await ctx.plugin(SkillRegistry);
  await ctx.plugin(LocalFileSystem, { cwd });
  await ctx.plugin(ApprovalService);
  let credentialEffects = 0;
  let heavyRuntimeEffects = 0;
  let httpEffects = 0;
  ctx.provide("credentials", {
    async deleteRecord() { credentialEffects += 1; },
    async modifyRecord(_key: unknown, transform: (record: undefined) => Promise<unknown>) {
      credentialEffects += 1;
      return await transform(undefined);
    },
    async readRecord() { credentialEffects += 1; return undefined; },
  } as unknown as Context["credentials"]);
  const approvals: string[] = [];
  ctx.on("approval/request", (request) => {
    approvals.push(request.toolName);
    return Promise.resolve(outcome);
  });
  const fiber = ctx.plugin({
    name: "dsh-parity-policy-probe",
    inject,
    apply(child: Context) {
      mountWorkspaceAuthentication(child, {
        contentRuntime: {
          createRuntime: (() => {
            heavyRuntimeEffects += 1;
            throw new Error("parity heavy runtime sentinel");
          }) as never,
        },
        fetcher: async () => {
          httpEffects += 1;
          return Response.json({ code: "fixture" }, { status: 400 });
        },
        office: Object.fromEntries([
          "exportToBuffer",
          "importBuffer",
          "inspectSource",
          "openSource",
          "writeOutput",
        ].map((name) => [name, () => {
          heavyRuntimeEffects += 1;
          throw new Error("parity Office sentinel");
        }])) as never,
        render: {
          createRenderRuntime: (() => {
            heavyRuntimeEffects += 1;
            throw new Error("parity Render sentinel");
          }) as never,
          createSlideLayoutRuntime: (() => {
            heavyRuntimeEffects += 1;
            throw new Error("parity Render sentinel");
          }) as never,
        },
        svg: {
          createFeature: (() => {
            heavyRuntimeEffects += 1;
            throw new Error("parity SVG sentinel");
          }) as never,
        },
      });
    },
  });
  await fiber;
  const id = SessionId(`parity-${outcome}`);
  const session = Session.create(id, [], { version: 0, createdAt: 0, cwd, id });
  session.append("turn/start", { turn: 1 });
  session.append("step/start", { turn: 1, step: 1 });
  return {
    agent: { session },
    approvals,
    ctx,
    cwd,
    effects: () => ({
      credentials: credentialEffects,
      heavyRuntime: heavyRuntimeEffects,
      http: httpEffects,
    }),
  };
}

function operationPolicies(): Map<string, "conditional" | "none" | "required"> {
  const policies = new Map<string, "conditional" | "none" | "required">();
  for (const outcome of PARITY_MANIFEST.outcomes) {
    const approval = "approval" in outcome ? outcome.approval : { required: [], conditional: [] };
    for (const operation of outcome.operations) {
      policies.set(
        operation,
        approval.required.includes(operation as never)
          ? "required"
          : approval.conditional.includes(operation as never) ? "conditional" : "none",
      );
    }
  }
  return policies;
}

function probeArguments(name: string, parameters: Record<string, unknown>, cwd: string): unknown {
  const generated = sampleSchema(parameters) as Record<string, unknown>;
  const overrides: Record<string, Record<string, unknown>> = {
    workspace_auth_start: { origin: "https://workspace.test" },
    workspace_blob_upload: { source_path: "source.bin", space_id: "space-1" },
    workspace_content_execute: { code: "return null;", unit_id: "unit-1", worktree_id: "wt-1" },
    workspace_node_move: { node_id: "node-1", parent_node_id: null },
    workspace_office_export: { output_path: "output.xlsx", unit_id: "unit-1", worktree_id: "wt-1" },
    workspace_office_import: { source_path: "source.xlsx", space_id: "space-1", worktree_id: "wt-1" },
    workspace_resource_export: { handles: ["boards-local-svgl/basic-arrow"], output_directory: "resource-output" },
    workspace_screenshot: { scope: "trunk", unit_id: "unit-1" },
    workspace_svg_apply: { page: 1, source_path: "source.svg", unit_id: "unit-1", worktree_id: "wt-1" },
    workspace_svg_compile: { output_path: "program.js", page: 1, source_path: "source.svg" },
    workspace_typst_apply: { bundle_path: "bundle", space_id: "space-1", worktree_id: "wt-1" },
    workspace_typst_compile: { artifact_directory: "artifacts", bundle_path: "bundle" },
    workspace_worktree_create: { name: "Parity", scope: "user" },
    workspace_worktree_update: { name: "Parity", worktree_id: "wt-1" },
  };
  void cwd;
  return { ...generated, ...overrides[name] };
}

function sampleSchema(schema: unknown): unknown {
  if (typeof schema !== "object" || schema === null || Array.isArray(schema)) return null;
  const value = schema as {
    anyOf?: unknown[];
    const?: unknown;
    enum?: unknown[];
    items?: unknown;
    minimum?: number;
    minItems?: number;
    properties?: Record<string, unknown>;
    oneOf?: unknown[];
    required?: boolean | string[];
    type?: string;
  };
  if ("const" in value) return value.const;
  if (value.enum?.length) return value.enum[0];
  if (value.anyOf?.length) return sampleSchema(value.anyOf[0]);
  if (value.oneOf?.length) return sampleSchema(value.oneOf[0]);
  if (value.type === "object") return Object.fromEntries(
    (Array.isArray(value.required)
      ? value.required
      : Object.entries(value.properties ?? {}).flatMap(([key, property]) =>
        typeof property === "object"
        && property !== null
        && !Array.isArray(property)
        && (property as { required?: unknown }).required === true
          ? [key]
          : [])).map((key) => [key, sampleSchema(value.properties?.[key])]),
  );
  if (value.type === "array") {
    return Array.from({ length: Math.max(1, value.minItems ?? 0) }, () => sampleSchema(value.items));
  }
  if (value.type === "integer" || value.type === "number") return Math.max(1, value.minimum ?? 1);
  if (value.type === "boolean") return false;
  if (value.type === "string") return "value";
  return null;
}

function validateCatalog(snapshot: CatalogSnapshot): void {
  const operationNames = PARITY_MANIFEST.outcomes.flatMap(({ operations }) => operations).sort();
  const skillNames = PARITY_MANIFEST.outcomes.flatMap(({ skills }) => skills).sort();
  if (!same(snapshot.tools.map(({ name }) => name), operationNames)) {
    throw new Error("tool catalog differs from parity manifest");
  }
  if (!same(snapshot.skills.map(({ name }) => name), skillNames)) {
    throw new Error("Skill catalog differs from parity manifest");
  }
  for (const tool of snapshot.tools) {
    if (tool.description.trim() === "" || hasOpenObject(tool.output)) {
      throw new Error(`open or incomplete tool schema: ${tool.name}`);
    }
  }
  for (const skill of snapshot.skills) {
    if (skill.description.trim() === "" || skill.provider !== "runtime" || skill.source !== "bundled") {
      throw new Error(`invalid Skill summary: ${skill.name}`);
    }
  }
}

function hasOpenObject(schema: unknown): boolean {
  if (Array.isArray(schema)) return schema.some(hasOpenObject);
  if (typeof schema !== "object" || schema === null) return false;
  const candidate = schema as { additionalProperties?: unknown; type?: unknown };
  if (candidate.type === "object" && candidate.additionalProperties !== false) return true;
  return Object.values(candidate).some(hasOpenObject);
}

function same(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length
    && new Set(actual).size === actual.length
    && actual.every((value, index) => value === expected[index]);
}
