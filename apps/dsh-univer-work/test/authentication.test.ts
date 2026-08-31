import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context } from "@deepseek-ai/cordis";
import CodeRuntime, {
  type CodeJsonValue,
  type CodeRunRequest,
  type CodeRunResult,
} from "@deepseek-ai/dsh-code-runtime";
import {
  CredentialProvider,
  type CredentialInfo,
  type CredentialKey,
  type CredentialRecord,
  type CredentialRecordEntry,
  type CredentialRecordInfo,
  type CredentialRef,
  type ResolvedCredential,
} from "@deepseek-ai/dsh-credentials";
import { CallId, createToolResultMessage } from "@deepseek-ai/dsh-llm";
import { Session, SessionId } from "@deepseek-ai/dsh-session";
import SkillRegistry from "@deepseek-ai/dsh-skill";
import SystemPrompt from "@deepseek-ai/dsh-system-prompt";
import ToolRuntime, {
  defineTool,
  renderToolsSdk,
  type CodeDispatchEventData,
  type CodeDispatchStartEventData,
  type ToolExecutionResult,
} from "@deepseek-ai/dsh-tools";
import ApprovalService, { type ApprovalOutcome } from "@deepseek-ai/dsh-user-approval";
import LocalFileSystem from "@deepseek-ai/dsh-fs-local";
import {
  whoami,
  type WorkspaceContentRuntime,
} from "@univerjs/univer-workspace-client-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mountWorkspaceAuthentication } from "../src/authentication.js";
import { UNIVER_LICENSE } from "../src/license.js";
import {
  AuthMutationQueue,
  grantRecord,
  parseWorkspaceGrantRecord,
  resolveAuthenticatedWorkspaceHttp,
  WORKSPACE_CREDENTIAL_KEY,
  WorkspaceAuthenticationRequiredError,
  WorkspaceCredentialError,
  type AuthenticatedWorkspaceGrant,
  type PendingWorkspaceGrant,
} from "../src/authentication-state.js";

const origin = "https://workspace.test";
const fixedNow = 1_787_878_800_000;
const deviceCode = "d".repeat(43);
const cookie = "workspace_session=test";
const signal = new AbortController().signal;
const contexts: Context[] = [];

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(async (ctx) => await ctx.fiber.dispose()));
});

describe("Workspace authentication credential state", () => {
  it("accepts only the exact pending and authenticated grant shapes", () => {
    expect(parseWorkspaceGrantRecord(grantRecord(pending()))).toEqual(pending());
    expect(parseWorkspaceGrantRecord(grantRecord(authenticated()))).toEqual(authenticated());

    const invalid: unknown[] = [
      { kind: "api-key" },
      { kind: "grant", payload: null },
      { kind: "grant", payload: { ...pending(), extra: true } },
      { kind: "grant", payload: { ...pending(), state: "other" } },
      { kind: "grant", payload: { ...pending(), deviceCode: "short" } },
      { kind: "grant", payload: { ...pending(), userCode: "ABCI-EFGH" } },
      { kind: "grant", payload: { ...pending(), origin: `${origin}/path` } },
      { kind: "grant", payload: { ...pending(), verificationUrl: "https://other.test/cli-login?userCode=ABCD-EFGH" } },
      { kind: "grant", payload: { ...pending(), verificationUrl: `${origin}/other?userCode=ABCD-EFGH` } },
      { kind: "grant", payload: { ...pending(), verificationUrl: `${origin}/cli-login?userCode=ABCD-EFGH&x=1` } },
      { kind: "grant", payload: { ...pending(), verificationUrl: `${origin}/cli-login?userCode=ABCD-EFGH#x` } },
      { kind: "grant", payload: { ...authenticated(), cookie: "" } },
      { kind: "grant", payload: authenticated({ cookie: "workspace.test" }) },
      { kind: "grant", payload: { ...authenticated(), subject: { id: cookie, name: "Alice" } } },
      { kind: "grant", payload: { ...authenticated(), subject: { id: "", name: "Alice" } } },
      { kind: "grant", payload: { ...authenticated(), subject: { id: "user-1", name: "Alice", extra: true } } },
    ];
    for (const record of invalid) {
      expect(() => parseWorkspaceGrantRecord(record as CredentialRecord)).toThrow(WorkspaceCredentialError);
    }
  });

  it.each(["origin", "userCode", "verificationUrl"] as const)(
    "rejects a raw device-code sentinel in safe %s without echoing it",
    (field) => {
      const candidate = pending();
      const value = field === "verificationUrl"
        ? `${origin}/cli-login?userCode=${deviceCode}`
        : deviceCode;
      let thrown: unknown;
      try {
        parseWorkspaceGrantRecord(grantRecord({ ...candidate, [field]: value }));
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(WorkspaceCredentialError);
      expect(String(thrown)).not.toContain(deviceCode);
    },
  );

  it("rejects a URL-decoded device-code sentinel before rendering", () => {
    const encoded = [...deviceCode].map((character) => `%${character.charCodeAt(0).toString(16)}`).join("");
    expect(() => parseWorkspaceGrantRecord(grantRecord({
      ...pending(),
      verificationUrl: `${origin}/cli-login?userCode=${encoded}`,
    }))).toThrow(WorkspaceCredentialError);
  });

  it("re-reads credential rotation for every authenticated operation", async () => {
    const ctx = await credentialContext();
    const requests: string[] = [];
    const fetcher: typeof fetch = async (input, init) => {
      requests.push(`${new URL(input instanceof Request ? input.url : input).pathname}:${new Headers(init?.headers).get("cookie")}`);
      return Response.json({ authenticated: true, user: { id: "server-user", displayName: "Server User" } });
    };
    await ctx.credentials.modifyRecord(WORKSPACE_CREDENTIAL_KEY, async () => grantRecord(authenticated({ cookie: "session=one" })));
    await whoami(await resolveAuthenticatedWorkspaceHttp(ctx.credentials, "client", fetcher));
    await ctx.credentials.modifyRecord(WORKSPACE_CREDENTIAL_KEY, async () => grantRecord(authenticated({ cookie: "session=two" })));
    await whoami(await resolveAuthenticatedWorkspaceHttp(ctx.credentials, "client", fetcher));
    await ctx.credentials.deleteRecord(WORKSPACE_CREDENTIAL_KEY);

    await expect(resolveAuthenticatedWorkspaceHttp(ctx.credentials, "client", fetcher))
      .rejects.toBeInstanceOf(WorkspaceAuthenticationRequiredError);
    expect(requests).toEqual(["/api/session:session=one", "/api/session:session=two"]);
  });

  it("rejects missing and pending records before creating authenticated HTTP", async () => {
    const ctx = await credentialContext();
    await expect(resolveAuthenticatedWorkspaceHttp(ctx.credentials, "client"))
      .rejects.toBeInstanceOf(WorkspaceAuthenticationRequiredError);
    await ctx.credentials.modifyRecord(WORKSPACE_CREDENTIAL_KEY, async () => grantRecord(pending()));
    await expect(resolveAuthenticatedWorkspaceHttp(ctx.credentials, "worker"))
      .rejects.toBeInstanceOf(WorkspaceAuthenticationRequiredError);
  });

  it("serializes process-local authentication mutations", async () => {
    const queue = new AuthMutationQueue();
    const order: string[] = [];
    let release!: () => void;
    const first = queue.run(async () => {
      order.push("first:start");
      await new Promise<void>((resolve) => { release = resolve; });
      order.push("first:end");
    });
    const second = queue.run(async () => { order.push("second"); });
    await vi.waitFor(() => expect(order).toEqual(["first:start"]));
    release();
    await Promise.all([first, second, queue.drain()]);
    expect(order).toEqual(["first:start", "first:end", "second"]);
  });
});

describe("Workspace authentication tools", () => {
  it("registers exactly four secret-free auth schemas", async () => {
    const { ctx, fiber } = await setup(async () => authorizationResponse());
    const schemas = ctx.tools.schemas().filter((schema) => schema.name.startsWith("workspace_auth_"));
    expect(schemas.map(({ name }) => name).sort()).toEqual([
      "workspace_auth_complete",
      "workspace_auth_logout",
      "workspace_auth_start",
      "workspace_auth_whoami",
    ]);
    expect(schemas.map(({ parameters }) => parameters.additionalProperties)).toEqual([
      false,
      false,
      false,
      false,
    ]);
    expect(schemas.find(({ name }) => name === "workspace_auth_start")?.parameters)
      .toMatchObject({ properties: {}, additionalProperties: false });
    expect(JSON.stringify(schemas)).not.toMatch(/password|deviceCode|cookie|grant/i);
    expect(ctx.tools.schemas().filter(({ name }) => name.startsWith("workspace_typst_"))
      .map(({ name }) => name).sort()).toEqual(["workspace_typst_apply", "workspace_typst_compile"]);
    expect(ctx.tools.schemas().filter(({ name }) => name.startsWith("workspace_svg_"))
      .map(({ name }) => name).sort()).toEqual(["workspace_svg_apply", "workspace_svg_compile"]);
    expect(ctx.tools.schemas().filter(({ name }) => name.startsWith("workspace_") && (
      name.includes("screenshot") || name.includes("layout_lint")
    )).map(({ name }) => name).sort()).toEqual([
      "workspace_layout_lint",
      "workspace_screenshot",
    ]);
    await fiber.dispose();
    expect(ctx.tools.schemas().filter(({ name }) => name.startsWith("workspace_typst_"))).toEqual([]);
    expect(ctx.tools.schemas().filter(({ name }) => name.startsWith("workspace_svg_"))).toEqual([]);
    expect(ctx.tools.schemas().filter(({ name }) => name.startsWith("workspace_") && (
      name.includes("screenshot") || name.includes("layout_lint")
    ))).toEqual([]);
  });

  it.each(["start", "complete", "whoami", "logout"] as const)(
    "rejects an unexpected own key before the %s body and preserves its canonical call",
    async (operation) => {
      const fetcher = vi.fn<typeof fetch>(async () => {
        if (operation === "start") return authorizationResponse();
        if (operation === "complete") {
          return Response.json(
            { authenticated: true, user: { id: "server-user", displayName: "Server User" } },
            { headers: { "set-cookie": "workspace_session=next; Path=/" } },
          );
        }
        if (operation === "whoami") {
          return Response.json({
            authenticated: true,
            user: { id: "server-user", displayName: "Server User" },
          });
        }
        return Response.json({});
      });
      let approvals = 0;
      const { ctx, credentials } = await setup(fetcher, true, () => { approvals += 1; });
      if (operation === "complete") credentials.seed(grantRecord(pending()));
      if (operation === "whoami" || operation === "logout") {
        credentials.seed(grantRecord(authenticated()));
      }
      credentials.resetObservations();

      const invalid = await execute(
        ctx,
        `workspace_auth_${operation}`,
        operation === "start" ? { origin } : { unexpected: true },
        operation === "logout" ? fakeAgent() : undefined,
      );

      expect(invalid).toMatchObject({ isError: true, error: { info: { code: "INVALID_ARGS" } } });
      expect(credentials.readStarted).toBe(false);
      expect(credentials.modifyStarted).toBe(false);
      expect(credentials.deleteStarted).toBe(false);
      expect(fetcher).not.toHaveBeenCalled();
      expect(approvals).toBe(0);

      const valid = await execute(
        ctx,
        `workspace_auth_${operation}`,
        {},
        operation === "logout" ? fakeAgent() : undefined,
      );

      expect(valid).toMatchObject({
        isError: false,
        value: {
          status: operation === "start"
            ? "authorization_required"
            : operation === "logout" ? "local_credentials_cleared" : "authenticated",
        },
      });
      expect(fetcher).toHaveBeenCalledOnce();
      expect(approvals).toBe(operation === "logout" ? 1 : 0);
    },
  );

  it("composes both Office tools with the authenticated Unit, source, and shared runtime owners", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "dsh-univer-work-office-composition-"));
    try {
      const inputPath = join(cwd, "input.xlsx");
      const outputPath = join(await realpath(cwd), "output.xlsx");
      await writeFile(inputPath, "strict-office-input");
      const createBodies: Record<string, unknown>[] = [];
      const fetcher = vi.fn<typeof fetch>(async (input, init) => {
        const url = new URL(String(input));
        if (url.pathname === "/api/worktrees/wt-1/units" && init?.method === "POST") {
          const body = JSON.parse(String(init.body)) as Record<string, unknown>;
          createBodies.push(body);
          return Response.json({
            unit: {
              activationState: "notApplicable",
              change: "added",
              draftHeadRevision: 0,
              mergeResult: "pending",
              name: body["name"],
              nodeId: "node-created",
              resourceId: "resource-created",
              source: "worktree",
              target: {
                parentNodeId: body["targetParentNodeId"],
                spaceId: body["targetSpaceId"],
              },
              unitId: "unit-created",
              unitType: body["unitType"],
            },
          });
        }
        if (url.pathname === "/api/worktrees/wt-1" && (init?.method ?? "GET") === "GET") {
          return Response.json({
            worktree: {
              id: "wt-1",
              name: "Draft",
              state: "draft",
              teamSpace: null,
              units: [{
                activationState: "notApplicable",
                change: "unchanged",
                draftHeadRevision: 17,
                mergeResult: "pending",
                name: "Exported Sheet",
                nodeId: "node-export",
                resourceId: "resource-export",
                source: "worktree",
                target: { parentNodeId: null, spaceId: "space-1" },
                unitId: "unit-export",
                unitType: "sheet",
              }],
            },
          });
        }
        throw new Error(`Unexpected Office Workspace request ${url.pathname}`);
      });
      const executeAndCommit = vi.fn();
      const exportUnitData = vi.fn(async (input) => {
        expect(input.target).toMatchObject({
          revision: 17,
          scope: { kind: "worktree", worktreeId: "wt-1" },
          unitId: "unit-export",
          unitType: "sheet",
        });
        return { id: "unit-export", exactRevision: 17 } as never;
      });
      const close = vi.fn(async () => undefined);
      const runtime: WorkspaceContentRuntime = {
        close,
        executeAndCommit,
        executeRead: vi.fn(),
        exportUnitData,
      };
      const importBuffer = vi.fn(async (bytes: Buffer, options: { readonly fileName: string }) => {
        expect(bytes.toString()).toBe("strict-office-input");
        expect(options.fileName).toBe("input.xlsx");
        return { id: "converted", name: "Imported Sheet" };
      });
      const exportToBuffer = vi.fn(async (data: Readonly<Record<string, unknown>>) => {
        expect(data).toEqual({ id: "unit-export", exactRevision: 17 });
        return Buffer.from("strict-office-output");
      });

      const ctx = new Context();
      contexts.push(ctx);
      await ctx.plugin(SystemPrompt);
      await ctx.plugin(ToolRuntime);
      await ctx.plugin(SkillRegistry);
      await ctx.plugin(MemoryCredentials);
      await ctx.plugin(LocalFileSystem, { cwd });
      await ctx.plugin(ApprovalService);
      ctx.on("approval/request", () => Promise.resolve<ApprovalOutcome>("allowed-once"));
      const fiber = ctx.plugin({
        name: "dsh-univer-work-office-composition-test",
        inject: ["credentials", "tools", "skills", "fs"],
        apply(child: Context) {
          mountWorkspaceAuthentication(child, {
            contentRuntime: { createRuntime: () => runtime },
            fetcher,
            now: () => fixedNow,
            office: { exportToBuffer, importBuffer },
          });
        },
      });
      await fiber;
      (ctx.credentials as MemoryCredentials).seed(grantRecord(authenticated()));
      expect(ctx.tools.schemas().filter(({ name }) => name.startsWith("workspace_office_"))
        .map(({ name }) => name).sort()).toEqual([
        "workspace_office_export",
        "workspace_office_import",
      ]);

      const agent = officeAgent(cwd);
      const imported = await execute(ctx, "workspace_office_import", {
        idempotency_key: "office-create-1",
        parent_node_id: "folder-1",
        source_path: "input.xlsx",
        space_id: "space-1",
        worktree_id: "wt-1",
      }, agent);
      expect(imported).toMatchObject({
        isError: false,
        value: {
          committed: true,
          name: "Imported Sheet",
          nodeId: "node-created",
          resourceId: "resource-created",
          type: "sheet",
          unitId: "unit-created",
          worktreeId: "wt-1",
        },
      });
      expect(createBodies).toEqual([{
        initialData: { id: "converted", name: "Imported Sheet" },
        name: "Imported Sheet",
        source: "worktree",
        targetParentNodeId: "folder-1",
        targetSpaceId: "space-1",
        unitType: "sheet",
      }]);

      const exported = await execute(ctx, "workspace_office_export", {
        output_path: "output.xlsx",
        unit_id: "unit-export",
        worktree_id: "wt-1",
      }, agent);
      expect(exported).toMatchObject({
        isError: false,
        value: {
          outputPath,
          type: "sheet",
          unitId: "unit-export",
          worktreeId: "wt-1",
        },
      });
      expect(await readFile(outputPath, "utf8")).toBe("strict-office-output");
      expect(importBuffer).toHaveBeenCalledOnce();
      expect(exportUnitData).toHaveBeenCalledOnce();
      expect(exportToBuffer).toHaveBeenCalledOnce();
      expect(executeAndCommit).not.toHaveBeenCalled();
      await fiber.dispose();
      expect(close).toHaveBeenCalledOnce();
      expect(ctx.tools.schemas().filter(({ name }) => name.startsWith("workspace_office_")))
        .toEqual([]);
    } finally {
      await rm(cwd, { force: true, recursive: true });
    }
  });

  it("composes real native Typst compile and authenticated apply without compile-only credentials or license", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "dsh-univer-work-typst-composition-"));
    try {
      await mkdir(join(cwd, "bundle"));
      await mkdir(join(cwd, "bundle", "pages"));
      await writeFile(join(cwd, "bundle", "pages", "one.typ"), "= Production Typst\n\nHello", "utf8");
      await writeFile(join(cwd, "bundle", "typst.json"), JSON.stringify({
        pages: ["pages/one.typ"],
        schemaVersion: 1,
        targetUnitId: "compiled-production-doc",
        title: "Production Typst",
      }), "utf8");
      let licenseResolutions = 0;
      const env = Object.defineProperty({}, "UNIVER_LICENSE", {
        get() {
          licenseResolutions += 1;
          return undefined;
        },
      }) as NodeJS.ProcessEnv;
      const requests: Array<{ readonly cookie: string | null; readonly method: string; readonly path: string }> = [];
      let gatedCreate: {
        readonly entered: ReturnType<typeof deferred<void>>;
        readonly release: ReturnType<typeof deferred<void>>;
        signal: AbortSignal | null | undefined;
      } | undefined;
      const fetcher = vi.fn<typeof fetch>(async (input, init) => {
        const url = new URL(String(input));
        requests.push({
          cookie: new Headers(init?.headers).get("cookie"),
          method: init?.method ?? "GET",
          path: url.pathname,
        });
        if (gatedCreate !== undefined) {
          gatedCreate.signal = init?.signal;
          gatedCreate.entered.resolve(undefined);
          await gatedCreate.release.promise;
        }
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return Response.json({
          unit: {
            activationState: "notApplicable",
            change: "added",
            draftHeadRevision: 0,
            mergeResult: "pending",
            name: body["name"],
            nodeId: "node-typst",
            resourceId: "resource-typst",
            source: "worktree",
            target: {
              parentNodeId: body["targetParentNodeId"],
              spaceId: body["targetSpaceId"],
            },
            unitId: "unit-typst",
            unitType: body["unitType"],
          },
        });
      });
      const ctx = new Context();
      contexts.push(ctx);
      await ctx.plugin(SystemPrompt);
      await ctx.plugin(ToolRuntime);
      await ctx.plugin(SkillRegistry);
      await ctx.plugin(MemoryCredentials);
      await ctx.plugin(LocalFileSystem, { cwd });
      await ctx.plugin(ApprovalService);
      ctx.on("approval/request", () => Promise.resolve<ApprovalOutcome>("allowed-once"));
      const mount = (name: string) => ctx.plugin({
        name,
        inject: ["credentials", "tools", "skills", "fs"],
        apply(child: Context) {
          mountWorkspaceAuthentication(child, {
            contentRuntime: { defaultLicense: UNIVER_LICENSE, env },
            fetcher,
          });
        },
      });
      const fiber = mount("dsh-univer-work-typst-production");
      await fiber;
      const agent = officeAgent(cwd);

      const compiled = await execute(ctx, "workspace_typst_compile", {
        artifact_directory: "compiled-artifacts",
        bundle_path: "bundle",
      }, agent);
      expect(compiled).toMatchObject({
        isError: false,
        value: { committed: false, targetUnitId: "compiled-production-doc" },
      });
      expect(requests).toEqual([]);
      expect(licenseResolutions).toBe(0);

      (ctx.credentials as MemoryCredentials).seed(grantRecord(authenticated({ cookie: "session=rotated" })));
      const applied = await execute(ctx, "workspace_typst_apply", {
        bundle_path: "bundle",
        idempotency_key: "typst-production-create",
        parent_node_id: "folder-1",
        space_id: "space-1",
        worktree_id: "wt-1",
      }, agent);
      expect(applied, JSON.stringify(applied)).toMatchObject({
        isError: false,
        value: {
          committed: true,
          previews: [],
          unit: { unitId: "unit-typst", worktreeId: "wt-1" },
        },
      });
      expect(licenseResolutions).toBe(1);
      expect(requests).toEqual([{
        cookie: "session=rotated",
        method: "POST",
        path: "/api/worktrees/wt-1/units",
      }]);
      expect(await readdir(cwd)).toEqual(["bundle", "compiled-artifacts"]);

      await fiber.dispose();
      expect(ctx.tools.schemas().some(({ name }) => name.startsWith("workspace_typst_"))).toBe(false);
      const remounted = mount("dsh-univer-work-typst-production-remount");
      await remounted;
      expect(ctx.tools.schemas().filter(({ name }) => name.startsWith("workspace_typst_")).length).toBe(2);
      gatedCreate = { entered: deferred<void>(), release: deferred<void>(), signal: undefined };
      const ownerOnly = execute(ctx, "workspace_typst_apply", {
        bundle_path: "bundle",
        idempotency_key: "typst-owner-only-success",
        parent_node_id: "folder-1",
        space_id: "space-1",
        worktree_id: "wt-1",
      }, agent);
      await gatedCreate.entered.promise;
      const disposal = remounted.dispose();
      await vi.waitFor(() => expect(gatedCreate?.signal?.aborted).toBe(true));
      let disposed = false;
      void disposal.then(() => { disposed = true; });
      await Promise.resolve();
      expect(disposed).toBe(false);
      gatedCreate.release.resolve(undefined);
      await expect(ownerOnly).resolves.toMatchObject({
        isError: false,
        value: { committed: true, unit: { unitId: "unit-typst", worktreeId: "wt-1" } },
      });
      await disposal;
      expect(licenseResolutions).toBe(2);
      expect(requests).toHaveLength(2);
      expect(ctx.tools.schemas().some(({ name }) => name.startsWith("workspace_typst_"))).toBe(false);
      expect(await readdir(cwd)).toEqual(["bundle", "compiled-artifacts"]);
    } finally {
      await rm(cwd, { force: true, recursive: true });
    }
  }, 30_000);

  it.each([
    ["caller", "workspace-result-unknown"],
    ["caller", "workspace-result-mismatch"],
    ["caller", "workspace-invalid-response"],
    ["owner", "workspace-result-unknown"],
    ["owner", "workspace-result-mismatch"],
    ["owner", "workspace-invalid-response"],
  ] as const)(
    "keeps the production generated Office idempotency identity after %s cancellation for %s",
    async (source, code) => {
      const cwd = await mkdtemp(join(tmpdir(), "dsh-univer-work-office-identity-"));
      try {
        await writeFile(join(cwd, "input.xlsx"), "strict-office-input");
        const entered = deferred<void>();
        const requests: Array<{ readonly body: unknown; readonly idempotencyKey: string | null }> = [];
        const secret = `production-${source}-${code}-cookie-license-unit-data-office-bytes`;
        const fetcher = vi.fn<typeof fetch>(async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname !== "/api/worktrees/wt-1/units" || init?.method !== "POST") {
            throw new Error(`Unexpected Office request ${url.pathname}`);
          }
          requests.push({
            body: JSON.parse(String(init.body)) as unknown,
            idempotencyKey: new Headers(init.headers).get("idempotency-key"),
          });
          entered.resolve();
          await waitForAbort(init.signal);
          if (code === "workspace-result-unknown") throw new Error(secret);
          if (code === "workspace-invalid-response") return Response.json({ unit: { secret } });
          return Response.json({
            unit: {
              activationState: "notApplicable",
              change: "added",
              draftHeadRevision: 0,
              mergeResult: "pending",
              name: "Different Unit",
              nodeId: "node-created",
              resourceId: "resource-created",
              source: "worktree",
              target: { parentNodeId: null, spaceId: "space-1" },
              unitId: "unit-created",
              unitType: "sheet",
            },
          });
        });
        const importBuffer = vi.fn(async () => ({ id: "converted", name: "Imported Sheet" }));
        const ctx = new Context();
        contexts.push(ctx);
        await ctx.plugin(SystemPrompt);
        await ctx.plugin(ToolRuntime);
        await ctx.plugin(SkillRegistry);
        await ctx.plugin(MemoryCredentials);
        await ctx.plugin(LocalFileSystem, { cwd });
        await ctx.plugin(ApprovalService);
        ctx.on("approval/request", () => Promise.resolve<ApprovalOutcome>("allowed-once"));
        const fiber = ctx.plugin({
          name: `dsh-univer-work-office-identity-${source}-${code}`,
          inject: ["credentials", "tools", "skills", "fs"],
          apply(child: Context) {
            mountWorkspaceAuthentication(child, {
              fetcher,
              now: () => fixedNow,
              office: { importBuffer },
            });
          },
        });
        await fiber;
        (ctx.credentials as MemoryCredentials).seed(grantRecord(authenticated()));
        const controller = new AbortController();
        const pending = execute(ctx, "workspace_office_import", {
          source_path: "input.xlsx",
          space_id: "space-1",
          worktree_id: "wt-1",
        }, officeAgent(cwd), controller.signal);
        await entered.promise;
        const disposal = source === "owner" ? fiber.dispose() : undefined;
        if (source === "caller") controller.abort(new Error(`${secret}-abort`));
        const result = await pending;
        await disposal;
        if (source === "caller") await fiber.dispose();
        expect(result).toMatchObject({ isError: true, error: { info: { code } } });
        expect(importBuffer).toHaveBeenCalledOnce();
        expect(requests).toHaveLength(1);
        const idempotencyKey = requests[0]!.idempotencyKey;
        expect(idempotencyKey).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
        expect(parseFailureEnvelope(result.error!.message)).toEqual({
          code,
          detail: {
            ...(code === "workspace-result-unknown" ? { idempotencyKey } : {}),
            spaceId: "space-1",
            worktreeId: "wt-1",
          },
        });
        expect(JSON.stringify({ requests, result })).not.toContain(secret);
      } finally {
        await rm(cwd, { force: true, recursive: true });
      }
    },
  );

  it("starts once, stores the pending secret, and safely reuses the live handoff", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => authorizationResponse());
    const { ctx } = await setup(fetcher, false, undefined, `${origin}/`);
    const first = await execute(ctx, "workspace_auth_start", {});
    const second = await execute(ctx, "workspace_auth_start", {});

    expect(first).toMatchObject({
      isError: false,
      value: {
        status: "authorization_required",
        origin,
        userCode: "ABCD-EFGH",
        verificationUrl: `${origin}/cli-login?userCode=ABCD-EFGH`,
      },
    });
    expect(second.value).toEqual(first.value);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.stringify([first, second])).not.toContain(deviceCode);
    expect(parseWorkspaceGrantRecord(await ctx.credentials.readRecord(WORKSPACE_CREDENTIAL_KEY))).toEqual(pending());
  });

  it("routes authentication to the Host-configured Workspace Authority, not the DSH Host", async () => {
    const workspaceOrigin = "http://127.0.0.1:3020";
    const requests: string[] = [];
    const { ctx } = await setup(async (input) => {
      requests.push(input instanceof Request ? input.url : String(input));
      return authorizationResponse();
    }, false, undefined, workspaceOrigin);

    const result = await execute(ctx, "workspace_auth_start", {});

    expect(result).toMatchObject({
      isError: false,
      value: {
        origin: workspaceOrigin,
        verificationUrl: `${workspaceOrigin}/cli-login?userCode=ABCD-EFGH`,
      },
    });
    expect(requests).toEqual([`${workspaceOrigin}/api/auth/cli/authorizations`]);
    expect(requests.every((url) => !url.startsWith("http://127.0.0.1:3080"))).toBe(true);
  });

  it.each(["", "http://127.0.0.1:3020/path"])(
    "rejects missing or malformed Host origin %j before HTTP",
    async (workspaceOrigin) => {
      const fetcher = vi.fn<typeof fetch>();
      const { ctx } = await setup(fetcher, false, undefined, workspaceOrigin);

      const result = await execute(ctx, "workspace_auth_start", {});

      expect(result).toMatchObject({
        isError: true,
        error: { info: { code: "workspace-origin-invalid" } },
      });
      expect(fetcher).not.toHaveBeenCalled();
    },
  );

  it("renders a contract-valid expiry outside the Date domain after committing the same handoff", async () => {
    const expiresIn = 8_700_000_000_000;
    const { ctx } = await setup(async () => authorizationResponse({ expiresIn }));
    const result = await execute(ctx, "workspace_auth_start", {});
    const expiresAt = fixedNow + expiresIn * 1000;

    expect(result).toMatchObject({
      isError: false,
      value: { status: "authorization_required", expiresAt },
      content: [{ text: expect.stringContaining(String(expiresAt)) }],
    });
    expect(parseWorkspaceGrantRecord(await ctx.credentials.readRecord(WORKSPACE_CREDENTIAL_KEY)))
      .toEqual(pending({ expiresAt }));
  });

  it("protects authenticated and other-origin records from start", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const { ctx } = await setup(fetcher);
    for (const grant of [authenticated(), pending({ origin: "https://other.test", verificationUrl: "https://other.test/cli-login?userCode=ABCD-EFGH" })]) {
      await ctx.credentials.modifyRecord(WORKSPACE_CREDENTIAL_KEY, async () => grantRecord(grant));
      const result = await execute(ctx, "workspace_auth_start", {});
      expect(result).toMatchObject({ isError: true, error: { info: { code: "workspace-authentication-conflict" } } });
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("returns missing, expired, pending, and authenticated completion outcomes without polling", async () => {
    const responses = [
      Response.json({ status: "pending" }, { status: 202 }),
      Response.json(
        { authenticated: true, user: { id: "user-2", displayName: "Bob" } },
        { headers: { "set-cookie": "workspace_session=next; Path=/" } },
      ),
    ];
    const fetcher = vi.fn<typeof fetch>(async () => responses.shift()!);
    const timeout = vi.spyOn(globalThis, "setTimeout");
    const { ctx } = await setup(fetcher);
    try {
      expect((await execute(ctx, "workspace_auth_complete", {})).value).toEqual({ status: "authorization_missing" });
      await ctx.credentials.modifyRecord(WORKSPACE_CREDENTIAL_KEY, async () => grantRecord(pending({ expiresAt: fixedNow })));
      expect((await execute(ctx, "workspace_auth_complete", {})).value).toEqual({ status: "authorization_expired" });
      await ctx.credentials.modifyRecord(WORKSPACE_CREDENTIAL_KEY, async () => grantRecord(pending()));
      expect((await execute(ctx, "workspace_auth_complete", {})).value).toMatchObject({ status: "authorization_pending" });
      expect((await execute(ctx, "workspace_auth_complete", {})).value).toEqual({
        status: "authenticated",
        origin,
        subject: { id: "user-2", name: "Bob" },
      });
    } finally {
      timeout.mockRestore();
    }
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(parseWorkspaceGrantRecord(await ctx.credentials.readRecord(WORKSPACE_CREDENTIAL_KEY))).toEqual(authenticated({
      cookie: "workspace_session=next",
      subject: { id: "user-2", name: "Bob" },
    }));
  });

  it("serializes overlapping starts and performs only one HTTP exchange", async () => {
    let release!: () => void;
    const fetcher = vi.fn<typeof fetch>(async () => {
      await new Promise<void>((resolve) => { release = resolve; });
      return authorizationResponse();
    });
    const { ctx } = await setup(fetcher);
    const first = execute(ctx, "workspace_auth_start", {});
    const second = execute(ctx, "workspace_auth_start", {});
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    release();
    await expect(Promise.all([first, second])).resolves.toMatchObject([
      { value: { status: "authorization_required" } },
      { value: { status: "authorization_required" } },
    ]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("rejects an uncommitted post-request transition without exposing its response", async () => {
    const { ctx, credentials } = await setup(async () => authorizationResponse());
    credentials.beforeNextModify = () => credentials.seed(grantRecord(authenticated()));
    const result = await execute(ctx, "workspace_auth_start", {});
    expect(result).toMatchObject({
      isError: true,
      error: { info: { code: "workspace-authentication-state-conflict" } },
    });
    expect(JSON.stringify(result)).not.toContain(deviceCode);
    expect(parseWorkspaceGrantRecord(await credentials.readRecord(WORKSPACE_CREDENTIAL_KEY))).toEqual(authenticated());
  });

  it("maps malformed post-start and post-complete CAS observations to state conflict", async () => {
    const malformed: CredentialRecord = { kind: "api-key", key: "private" };

    const startFetcher = vi.fn<typeof fetch>(async () => authorizationResponse());
    const startSetup = await setup(startFetcher);
    startSetup.credentials.beforeNextModify = () => startSetup.credentials.seed(malformed);
    const startResult = await execute(startSetup.ctx, "workspace_auth_start", {});

    const completeFetcher = vi.fn<typeof fetch>(async () => Response.json(
      { authenticated: true, user: { id: "uncommitted-user", displayName: "Uncommitted" } },
      { headers: { "set-cookie": "workspace_session=uncommitted; Path=/" } },
    ));
    const completeSetup = await setup(completeFetcher);
    completeSetup.credentials.seed(grantRecord(pending()));
    completeSetup.credentials.beforeNextModify = () => completeSetup.credentials.seed(malformed);
    const completeResult = await execute(completeSetup.ctx, "workspace_auth_complete", {});

    for (const [result, credentials] of [
      [startResult, startSetup.credentials],
      [completeResult, completeSetup.credentials],
    ] as const) {
      expect(result).toMatchObject({
        isError: true,
        error: { info: { code: "workspace-authentication-state-conflict" } },
      });
      expect(await credentials.readRecord(WORKSPACE_CREDENTIAL_KEY)).toEqual(malformed);
      const visible = JSON.stringify(result);
      expect(visible).not.toContain(deviceCode);
      expect(visible).not.toContain("uncommitted-user");
      expect(visible).not.toContain("workspace_session=uncommitted");
    }
    expect(startFetcher).toHaveBeenCalledTimes(1);
    expect(completeFetcher).toHaveBeenCalledTimes(1);
  });

  it("sanitizes malicious handoff and dependency errors", async () => {
    const dependencySentinel = "credential-provider-private-value";
    const fetcher = vi.fn<typeof fetch>(async () => authorizationResponse({
      verificationUriComplete: `${origin}/cli-login?userCode=${deviceCode}`,
    }));
    const { ctx, credentials } = await setup(fetcher);
    const malformed = await execute(ctx, "workspace_auth_start", {});
    credentials.readFailure = new Error(dependencySentinel, { cause: new Error(cookie) });
    const providerFailure = await execute(ctx, "workspace_auth_whoami", {});
    const transcript = JSON.stringify([malformed, providerFailure]);
    expect([malformed, providerFailure]).toMatchObject([
      { isError: true, error: { info: { code: "workspace-credential-invalid" } } },
      { isError: true, error: { info: { code: "workspace-auth-whoami-failed" } } },
    ]);
    expect(transcript).not.toContain(deviceCode);
    expect(transcript).not.toContain(dependencySentinel);
    expect(transcript).not.toContain(cookie);
  });

  it("classifies malformed encoded Server subjects as invalid responses", async () => {
    const completion = await setup(async () => Response.json(
      { authenticated: true, user: { id: "%", displayName: "Malformed" } },
      { headers: { "set-cookie": "workspace_session=next; Path=/" } },
    ));
    completion.credentials.seed(grantRecord(pending()));
    const completionResult = await execute(completion.ctx, "workspace_auth_complete", {});
    expect(completionResult).toMatchObject({
      isError: true,
      error: { info: { code: "workspace-invalid-response" } },
    });
    expect(parseWorkspaceGrantRecord(
      await completion.credentials.readRecord(WORKSPACE_CREDENTIAL_KEY),
    )).toEqual(pending());

    const identity = await setup(async () => Response.json({
      authenticated: true,
      user: { id: "server-user", displayName: "%" },
    }));
    identity.credentials.seed(grantRecord(authenticated()));
    expect(await execute(identity.ctx, "workspace_auth_whoami", {})).toMatchObject({
      isError: true,
      error: { info: { code: "workspace-invalid-response" } },
    });
  });

  it("rejects a completion cookie reflected by the model-visible origin", async () => {
    const completion = await setup(async () => Response.json(
      { authenticated: true, user: { id: "server-user", displayName: "Server User" } },
      { headers: { "set-cookie": "workspace.test; Path=/" } },
    ));
    completion.credentials.seed(grantRecord(pending()));
    expect(await execute(completion.ctx, "workspace_auth_complete", {})).toMatchObject({
      isError: true,
      error: { info: { code: "workspace-invalid-response" } },
    });
    expect(parseWorkspaceGrantRecord(
      await completion.credentials.readRecord(WORKSPACE_CREDENTIAL_KEY),
    )).toEqual(pending());
  });

  it("uses the Server-authoritative User and fails closed without logout approval", async () => {
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const path = new URL(input instanceof Request ? input.url : input).pathname;
      return path === "/api/session"
        ? Response.json({ authenticated: true, user: { id: "server-user", displayName: "Server User" } })
        : Response.json({});
    });
    const { ctx } = await setup(fetcher);
    await ctx.credentials.modifyRecord(WORKSPACE_CREDENTIAL_KEY, async () => grantRecord(authenticated()));
    expect((await execute(ctx, "workspace_auth_whoami", {})).value).toEqual({
      status: "authenticated",
      subject: { id: "server-user", name: "Server User" },
    });

    const denied = await execute(ctx, "workspace_auth_logout", {});
    expect(denied.isError).toBe(true);
    expect(await ctx.credentials.readRecord(WORKSPACE_CREDENTIAL_KEY)).toBeDefined();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("approved logout clears locally before remote success or failure settles", async () => {
    for (const remote of ["success", "failure"] as const) {
      const fetcher = vi.fn<typeof fetch>(async () => {
        if (remote === "failure") throw new Error("transport-private-value");
        return Response.json({});
      });
      const { ctx } = await setup(fetcher, true);
      await ctx.credentials.modifyRecord(WORKSPACE_CREDENTIAL_KEY, async () => grantRecord(authenticated()));
      const result = await execute(ctx, "workspace_auth_logout", {}, fakeAgent());
      expect(await ctx.credentials.readRecord(WORKSPACE_CREDENTIAL_KEY)).toBeUndefined();
      if (remote === "success") expect(result.value).toEqual({ status: "local_credentials_cleared" });
      else expect(result).toMatchObject({ isError: true, error: { info: { code: "workspace-result-unknown" } } });
      expect(JSON.stringify(result)).not.toContain("transport-private-value");
    }
  });

  it.each(["absent", "pending", "invalid"] as const)(
    "approved %s logout clears locally without a remote request",
    async (state) => {
      const invalidSentinel = "malformed-logout-private-value";
      const fetcher = vi.fn<typeof fetch>();
      const { ctx, credentials } = await setup(fetcher, true);
      if (state === "pending") credentials.seed(grantRecord(pending()));
      if (state === "invalid") {
        credentials.seed({ kind: "grant", payload: { state: "invalid", marker: invalidSentinel } });
      }

      const result = await execute(ctx, "workspace_auth_logout", {}, fakeAgent());

      expect(fetcher).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        isError: false,
        value: { status: "local_credentials_cleared" },
      });
      expect(await credentials.readRecord(WORKSPACE_CREDENTIAL_KEY)).toBeUndefined();
      expect(JSON.stringify(result)).not.toContain(invalidSentinel);
    },
  );

  it("does not report logout success when local deletion fails", async () => {
    const { ctx, credentials } = await setup(async () => Response.json({}), true);
    await ctx.credentials.modifyRecord(WORKSPACE_CREDENTIAL_KEY, async () => grantRecord(authenticated()));
    credentials.deleteFailure = new Error("delete-private-value");
    const result = await execute(ctx, "workspace_auth_logout", {}, fakeAgent());
    expect(result).toMatchObject({ isError: true, error: { info: { code: "workspace-auth-logout-failed" } } });
    expect(await credentials.readRecord(WORKSPACE_CREDENTIAL_KEY)).toBeDefined();
    expect(JSON.stringify(result)).not.toContain("delete-private-value");
  });

  it.each(["start", "complete", "whoami", "logout"] as const)(
    "forwards caller cancellation through the %s request and drains the body",
    async (operation) => {
      let observed: AbortSignal | null | undefined;
      const fetcher: typeof fetch = async (_input, init) => {
        observed = init?.signal;
        return await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
        });
      };
      const { ctx, credentials } = await setup(fetcher, operation === "logout");
      if (operation === "complete") credentials.seed(grantRecord(pending()));
      if (operation === "whoami" || operation === "logout") credentials.seed(grantRecord(authenticated()));
      const controller = new AbortController();
      const call = execute(
        ctx,
        `workspace_auth_${operation}`,
        {},
        operation === "logout" ? fakeAgent() : undefined,
        controller.signal,
      );
      await vi.waitFor(() => expect(observed).toBeInstanceOf(AbortSignal));
      controller.abort(new Error("caller cancellation sentinel"));
      await expect(call).resolves.toMatchObject({ isError: true });
      expect(observed?.aborted).toBe(true);
      if (operation === "logout") {
        expect(await ctx.credentials.readRecord(WORKSPACE_CREDENTIAL_KEY)).toBeUndefined();
      }
    },
  );

  it.each(["start", "complete", "whoami"] as const)(
    "does not return %s success when transport resolves after owner abort",
    async (operation) => {
      let observed: AbortSignal | null | undefined;
      let releaseResponse!: () => void;
      const responseGate = new Promise<void>((resolve) => { releaseResponse = resolve; });
      const fetcher: typeof fetch = async (_input, init) => {
        observed = init?.signal;
        await responseGate;
        if (operation === "start") return authorizationResponse();
        if (operation === "complete") return Response.json({ status: "pending" }, { status: 202 });
        return Response.json({
          authenticated: true,
          user: { id: "server-user", displayName: "Server User" },
        });
      };
      const { ctx, credentials, fiber } = await setup(fetcher);
      if (operation === "complete") credentials.seed(grantRecord(pending()));
      if (operation === "whoami") credentials.seed(grantRecord(authenticated()));
      const call = execute(
        ctx,
        `workspace_auth_${operation}`,
        {},
      );
      await vi.waitFor(() => expect(observed).toBeInstanceOf(AbortSignal));
      const disposal = fiber.dispose();
      await vi.waitFor(() => expect(observed?.aborted).toBe(true));
      releaseResponse();
      const result = await call;
      await disposal;
      expect(result).toMatchObject({ isError: true });
      expect(JSON.stringify(result)).not.toMatch(/authorization_pending|Server User/);
      expect(parseWorkspaceGrantRecord(
        await credentials.readRecord(WORKSPACE_CREDENTIAL_KEY),
      )).toEqual(operation === "complete"
        ? pending()
        : operation === "whoami" ? authenticated() : undefined);
    },
  );

  it.each([
    ["caller", "start-reuse"],
    ["caller", "complete-missing"],
    ["caller", "complete-authenticated"],
    ["caller", "complete-expired"],
    ["caller", "complete-invalid"],
    ["caller", "whoami-authenticated"],
    ["owner", "start-reuse"],
    ["owner", "complete-missing"],
    ["owner", "complete-authenticated"],
    ["owner", "complete-expired"],
    ["owner", "complete-invalid"],
    ["owner", "whoami-authenticated"],
  ] as const)(
    "stops %s-aborted %s after a gated credential read",
    async (abortSource, scenario) => {
      const fetcher = vi.fn<typeof fetch>();
      const { ctx, credentials, fiber } = await setup(fetcher);
      if (scenario === "start-reuse") credentials.seed(grantRecord(pending()));
      if (scenario === "complete-authenticated") credentials.seed(grantRecord(authenticated()));
      if (scenario === "whoami-authenticated") credentials.seed(grantRecord(authenticated()));
      if (scenario === "complete-expired") {
        credentials.seed(grantRecord(pending({ expiresAt: fixedNow })));
      }
      if (scenario === "complete-invalid") credentials.seed({ kind: "api-key", key: "private" });
      let releaseRead!: () => void;
      credentials.readGate = new Promise<void>((resolve) => { releaseRead = resolve; });
      const controller = new AbortController();
      const call = execute(
        ctx,
        scenario === "start-reuse"
          ? "workspace_auth_start"
          : scenario === "whoami-authenticated" ? "workspace_auth_whoami" : "workspace_auth_complete",
        {},
        undefined,
        controller.signal,
      );
      await vi.waitFor(() => expect(credentials.readStarted).toBe(true));
      let disposal: Promise<void> | undefined;
      if (abortSource === "caller") controller.abort(new Error("caller abort during credential read"));
      else disposal = fiber.dispose();
      releaseRead();
      await expect(call).resolves.toMatchObject({ isError: true });
      await disposal;
      expect(fetcher).not.toHaveBeenCalled();
      expect(credentials.deleteStarted).toBe(false);
    },
  );

  it.each(["start", "complete", "whoami", "logout"] as const)(
    "aborts the in-flight %s request and unregisters tools before disposal settles",
    async (operation) => {
      let observed: AbortSignal | null | undefined;
      const fetcher: typeof fetch = async (_input, init) => {
        observed = init?.signal;
        return await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
        });
      };
      const { ctx, credentials, fiber } = await setup(fetcher, operation === "logout");
      if (operation === "complete") credentials.seed(grantRecord(pending()));
      if (operation === "whoami" || operation === "logout") credentials.seed(grantRecord(authenticated()));
      const controller = new AbortController();
      const call = execute(
        ctx,
        `workspace_auth_${operation}`,
        {},
        operation === "logout" ? fakeAgent() : undefined,
        controller.signal,
      );
      await vi.waitFor(() => expect(observed).toBeInstanceOf(AbortSignal));
      const disposal = fiber.dispose();
      await vi.waitFor(() => expect(
        ctx.tools.schemas().filter(({ name }) => name.startsWith("workspace_auth_")),
      ).toEqual([]));
      await expect(call).resolves.toMatchObject({ isError: true });
      await disposal;
      expect(observed?.aborted).toBe(true);
      controller.abort(new Error("late caller abort after disposal"));
      if (operation === "logout") {
        expect(await ctx.credentials.readRecord(WORKSPACE_CREDENTIAL_KEY)).toBeUndefined();
      }
      if (operation === "start") {
        const unregister = ctx.tools.register(defineTool({
          name: "workspace_auth_logout",
          description: "Lifecycle gate fixture.",
          parameters: {},
          output: {
            schema: {
              type: "object",
              additionalProperties: false,
              properties: { status: { type: "string", const: "dummy", required: true } },
            },
            render: () => [{ type: "text", text: "dummy" }],
          },
          execute: async () => ({ status: "dummy" as const }),
        }));
        expect(await execute(ctx, "workspace_auth_logout", {})).toMatchObject({
          isError: false,
          value: { status: "dummy" },
        });
        unregister();
      }
    },
  );

  it("drains an accepted queued logout through its non-cancellable delete", async () => {
    let firstObserved: AbortSignal | null | undefined;
    const fetcher: typeof fetch = async (_input, init) => {
      firstObserved = init?.signal;
      return await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      });
    };
    const { ctx, credentials, fiber } = await setup(fetcher, true);
    const first = execute(ctx, "workspace_auth_start", {});
    await vi.waitFor(() => expect(firstObserved).toBeInstanceOf(AbortSignal));

    let releaseDelete!: () => void;
    credentials.deleteGate = new Promise<void>((resolve) => { releaseDelete = resolve; });
    const logoutController = new AbortController();
    const listener = vi.spyOn(logoutController.signal, "addEventListener");
    const queuedLogout = execute(
      ctx,
      "workspace_auth_logout",
      {},
      fakeAgent(),
      logoutController.signal,
    );
    await vi.waitFor(() => expect(listener).toHaveBeenCalledWith("abort", expect.any(Function), { once: true }));
    const disposal = fiber.dispose();
    await expect(first).resolves.toMatchObject({ isError: true });
    await vi.waitFor(() => expect(credentials.deleteStarted).toBe(true));
    let disposed = false;
    void disposal.then(() => { disposed = true; });
    await Promise.resolve();
    expect(disposed).toBe(false);
    releaseDelete();
    await expect(queuedLogout).resolves.toMatchObject({
      isError: false,
      value: { status: "local_credentials_cleared" },
    });
    await disposal;
    expect(await credentials.readRecord(WORKSPACE_CREDENTIAL_KEY)).toBeUndefined();
  });

  it("keeps Native and Code Mode transcript projections free of credential material", async () => {
    const transportSentinel = "transport-private-sentinel";
    const providerSentinel = "provider-private-sentinel";
    const encodedDeviceCode = [...deviceCode]
      .map((character) => `%${character.charCodeAt(0).toString(16)}`)
      .join("");
    const maliciousUrls = [
      `${origin}/cli-login/${deviceCode}?userCode=ABCD-EFGH`,
      `${origin}/cli-login?userCode=ABCD-EFGH&next=${deviceCode}`,
      `${origin}/cli-login?userCode=ABCD-EFGH&next=${encodedDeviceCode}`,
    ];
    const transcriptCalls: Array<{
      readonly name: string;
      readonly arguments: Record<string, unknown>;
      readonly result: ToolExecutionResult;
    }> = [];
    const record = (
      name: string,
      arguments_: Record<string, unknown>,
      result: ToolExecutionResult,
    ): void => {
      transcriptCalls.push({ name, arguments: arguments_, result });
    };
    for (const verificationUriComplete of maliciousUrls) {
      const current = await setup(async () => authorizationResponse({ verificationUriComplete }));
      record(
        "workspace_auth_start",
        {},
        await execute(current.ctx, "workspace_auth_start", {}),
      );
    }
    const transport = await setup(async () => {
      throw new Error(transportSentinel, { cause: new Error(cookie) });
    });
    record(
      "workspace_auth_start",
      {},
      await execute(transport.ctx, "workspace_auth_start", {}),
    );
    const provider = await setup(async () => Response.json({}));
    provider.credentials.readFailure = new Error(providerSentinel, { cause: new Error(deviceCode) });
    record("workspace_auth_whoami", {}, await execute(provider.ctx, "workspace_auth_whoami", {}));

    for (const [name, secretCode] of [
      ["workspace_auth_complete", deviceCode],
      ["workspace_auth_whoami", cookie],
      ["workspace_auth_logout", cookie],
    ] as const) {
      const applicationFailure = await setup(async () => Response.json(
        { error: { code: secretCode, message: "attacker controlled" } },
        { status: 500 },
      ), name === "workspace_auth_logout");
      applicationFailure.credentials.seed(grantRecord(
        name === "workspace_auth_complete" ? pending() : authenticated(),
      ));
      const applicationResult = await execute(
        applicationFailure.ctx,
        name,
        {},
        name === "workspace_auth_logout" ? fakeAgent() : undefined,
      );
      expect(applicationResult).toMatchObject({
        isError: true,
        error: { info: { code: `workspace-auth-${name.slice("workspace_auth_".length)}-failed` } },
      });
      record(name, {}, applicationResult);
    }

    const stableFailure = await setup(async () => Response.json(
      { error: { code: "CLI_AUTHORIZATION_INVALID", message: "safe stable failure" } },
      { status: 500 },
    ));
    stableFailure.credentials.seed(grantRecord(pending()));
    const preserved = await execute(stableFailure.ctx, "workspace_auth_complete", {});
    expect(preserved).toMatchObject({
      isError: true,
      error: { info: { code: "CLI_AUTHORIZATION_INVALID" } },
    });
    record("workspace_auth_complete", {}, preserved);

    for (const reflectedSubject of [
      { id: deviceCode, name: "Reflected device" },
      { id: "reflected-cookie", name: cookie },
    ]) {
      const reflectedCompletion = await setup(async () => Response.json(
        { authenticated: true, user: { id: reflectedSubject.id, displayName: reflectedSubject.name } },
        { headers: { "set-cookie": `${cookie}; Path=/` } },
      ));
      reflectedCompletion.credentials.seed(grantRecord(pending()));
      const reflectedResult = await execute(
        reflectedCompletion.ctx,
        "workspace_auth_complete",
        {},
      );
      expect(reflectedResult).toMatchObject({
        isError: true,
        error: { info: { code: "workspace-invalid-response" } },
      });
      expect(parseWorkspaceGrantRecord(
        await reflectedCompletion.credentials.readRecord(WORKSPACE_CREDENTIAL_KEY),
      )).toEqual(pending());
      record("workspace_auth_complete", {}, reflectedResult);
    }

    const reflectedWhoami = await setup(async () => Response.json({
      authenticated: true,
      user: { id: "reflected-cookie", displayName: cookie },
    }));
    reflectedWhoami.credentials.seed(grantRecord(authenticated()));
    const reflectedWhoamiResult = await execute(
      reflectedWhoami.ctx,
      "workspace_auth_whoami",
      {},
    );
    expect(reflectedWhoamiResult).toMatchObject({
      isError: true,
      error: { info: { code: "workspace-invalid-response" } },
    });
    record("workspace_auth_whoami", {}, reflectedWhoamiResult);

    const safe = await setup(async (input) => {
      const path = new URL(input instanceof Request ? input.url : input).pathname;
      if (path === "/api/auth/cli/authorizations") return authorizationResponse();
      if (path === "/api/auth/cli/authorizations/exchange") {
        return Response.json({ status: "pending" }, { status: 202 });
      }
      if (path === "/api/session") {
        return Response.json({ authenticated: true, user: { id: "server-user", displayName: "Server User" } });
      }
      return Response.json({});
    }, true);
    record(
      "workspace_auth_start",
      {},
      await execute(safe.ctx, "workspace_auth_start", {}),
    );
    record(
      "workspace_auth_complete",
      {},
      await execute(safe.ctx, "workspace_auth_complete", {}),
    );
    safe.credentials.seed(grantRecord(authenticated()));
    record("workspace_auth_whoami", {}, await execute(safe.ctx, "workspace_auth_whoami", {}));
    record(
      "workspace_auth_logout",
      {},
      await execute(safe.ctx, "workspace_auth_logout", {}, fakeAgent()),
    );

    const cancelled = await setup(async (_input, init) => await new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    }));
    const cancellation = new AbortController();
    const cancelledCall = execute(
      cancelled.ctx,
      "workspace_auth_start",
      {},
      undefined,
      cancellation.signal,
    );
    cancellation.abort(new Error("cancellation-private-sentinel"));
    record("workspace_auth_start", {}, await cancelledCall);

    const schemas = safe.ctx.tools.schemas().filter(({ name }) => name.startsWith("workspace_auth_"));
    const session = Session.create(SessionId("dsh-univer-work-auth-transcript"));
    session.append("turn/start", { turn: 1 });
    session.append("step/start", { turn: 1, step: 1 });
    for (const [index, call] of transcriptCalls.entries()) {
      appendTranscriptResult(session, index, call.name, call.arguments, call.result);
    }
    session.append("step/end", { turn: 1, step: 1 });
    session.append("turn/end", { turn: 1, reason: { kind: "completed" } });

    const sdkSchemas = schemas.map((schema) => ({
      ...schema,
      output: safe.ctx.tools.get(schema.name)!.output.schema,
    }));
    const transcript = JSON.stringify({
      codeModeSdk: renderToolsSdk(sdkSchemas),
      nativeSchemas: schemas,
      session: session.events,
    });
    for (const forbidden of [
      "password",
      deviceCode,
      encodedDeviceCode,
      cookie,
      "Set-Cookie",
      transportSentinel,
      providerSentinel,
      "cancellation-private-sentinel",
      JSON.stringify(grantRecord(authenticated())),
    ]) {
      expect(transcript).not.toContain(forbidden);
    }
  });

  it("keeps real run_code dispatch events free of credential material", async () => {
    const providerSentinel = "code-mode-provider-private-value";
    const { ctx, credentials, runtime } = await setupCodeMode(async () => authorizationResponse());
    runtime.dispatches = [
      { name: "workspace_auth_start", arguments: {} },
      {
        name: "workspace_auth_whoami",
        arguments: {},
        before: () => {
          credentials.readFailure = new Error(providerSentinel, { cause: new Error(cookie) });
        },
      },
    ];

    const session = Session.create(SessionId("dsh-univer-work-auth-code-transcript"));
    const agent = { session };
    const callId = CallId("auth-code-transcript");
    const arguments_ = {
      code: "return await exerciseWorkspaceAuthentication();",
      description: "Exercise Workspace authentication through Code Mode",
    };
    session.append("turn/start", { turn: 1 });
    session.append("step/start", { turn: 1, step: 1 });
    const call = session.append("tool/call", {
      turn: 1,
      step: 1,
      callId,
      name: "run_code",
      arguments: JSON.stringify(arguments_),
    });
    const result = await ctx.tools.execute({
      signal,
      callId,
      name: "run_code",
      arguments: arguments_,
      agent: agent as never,
    });
    session.append("tool/result", {
      turn: 1,
      step: 1,
      message: createToolResultMessage({ callId, content: result.content, isError: result.isError }),
      ...(result.error === undefined ? {} : { error: result.error.info }),
      ...(result.meta === undefined ? {} : { meta: result.meta }),
    }, { surfaceOp: "append", sourceEventSeqs: [call.seq] });
    session.append("step/end", { turn: 1, step: 1 });
    session.append("turn/end", { turn: 1, reason: { kind: "completed" } });

    expect(result).toMatchObject({ isError: false });
    expect(ctx.tools.schemas(agent as never).map(({ name }) => name)).toContain("run_code");
    expect(runtime.discoveredTools).toEqual(expect.arrayContaining([
      "workspace_typst_apply",
      "workspace_typst_compile",
    ]));
    const starts = session.events.flatMap((event) => event.type === "tool/code-dispatch-start"
      ? [event.data as CodeDispatchStartEventData]
      : []);
    const settles = session.events.flatMap((event) => event.type === "tool/code-dispatch"
      ? [event.data as CodeDispatchEventData]
      : []);
    expect(starts.map(({ name }) => name)).toEqual([
      "workspace_auth_start",
      "workspace_auth_whoami",
    ]);
    expect(settles.map(({ name }) => name)).toEqual(starts.map(({ name }) => name));
    expect(settles.map(({ subCallId }) => subCallId)).toEqual(starts.map(({ subCallId }) => subCallId));
    expect(settles).toMatchObject([
      { isError: false },
      { isError: true },
    ]);

    const transcript = JSON.stringify({ result, events: session.events });
    for (const forbidden of [deviceCode, cookie, providerSentinel, "password", "Set-Cookie"]) {
      expect(transcript).not.toContain(forbidden);
    }
  });
});

async function setup(
  fetcher: typeof fetch,
  approval = false,
  onApproval?: () => void,
  workspaceOrigin = origin,
): Promise<{
  readonly ctx: Context;
  readonly credentials: MemoryCredentials;
  readonly fiber: { dispose(): Promise<void> };
}> {
  const ctx = new Context();
  contexts.push(ctx);
  await ctx.plugin(SystemPrompt);
  await ctx.plugin(ToolRuntime);
  await ctx.plugin(SkillRegistry);
  await ctx.plugin(MemoryCredentials);
  if (approval) {
    await ctx.plugin(ApprovalService);
    ctx.on("approval/request", () => {
      onApproval?.();
      return Promise.resolve<ApprovalOutcome>("allowed-once");
    });
  }
  const fiber = ctx.plugin({
    name: "dsh-univer-work-authentication-test",
    inject: ["credentials", "tools", "skills"],
    apply(child: Context) {
      mountWorkspaceAuthentication(child, { fetcher, now: () => fixedNow, workspaceOrigin });
    },
  });
  await fiber;
  return { ctx, credentials: ctx.credentials as MemoryCredentials, fiber };
}

async function setupCodeMode(fetcher: typeof fetch): Promise<{
  readonly ctx: Context;
  readonly credentials: MemoryCredentials;
  readonly runtime: ControlledCodeRuntime;
}> {
  const ctx = new Context();
  contexts.push(ctx);
  await ctx.plugin(SystemPrompt);
  await ctx.plugin(ControlledCodeRuntime);
  await ctx.plugin(ToolRuntime, { mode: "code" });
  await ctx.plugin(SkillRegistry);
  await ctx.plugin(MemoryCredentials);
  const fiber = ctx.plugin({
    name: "dsh-univer-work-authentication-code-test",
    inject: ["credentials", "tools", "skills"],
    apply(child: Context) {
      mountWorkspaceAuthentication(child, { fetcher, now: () => fixedNow, workspaceOrigin: origin });
    },
  });
  await fiber;
  return {
    ctx,
    credentials: ctx.credentials as MemoryCredentials,
    runtime: ctx.codeRuntime as ControlledCodeRuntime,
  };
}

async function credentialContext(): Promise<Context> {
  const ctx = new Context();
  contexts.push(ctx);
  await ctx.plugin(MemoryCredentials);
  return ctx;
}

async function execute(
  ctx: Context,
  name: string,
  arguments_: Record<string, unknown>,
  agent?: unknown,
  executionSignal: AbortSignal = signal,
) {
  return await ctx.tools.execute({
    signal: executionSignal,
    callId: CallId(`${name}-${Math.random()}`),
    name,
    arguments: arguments_,
    ...(agent === undefined ? {} : { agent: agent as never }),
  });
}

function appendTranscriptResult(
  session: Session,
  index: number,
  name: string,
  arguments_: Record<string, unknown>,
  result: ToolExecutionResult,
): void {
  const callId = CallId(`auth-transcript-${index}`);
  const call = session.append("tool/call", {
    turn: 1,
    step: 1,
    callId,
    name,
    arguments: JSON.stringify(arguments_),
  });
  session.append("tool/result", {
    turn: 1,
    step: 1,
    message: createToolResultMessage({ callId, content: result.content, isError: result.isError }),
    ...(result.error === undefined ? {} : { error: result.error.info }),
    ...(result.meta === undefined ? {} : { meta: result.meta }),
  }, { surfaceOp: "append", sourceEventSeqs: [call.seq] });
}

function fakeAgent(): unknown {
  return { session: { events: [{ type: "turn/start" }], append: () => ({}) } };
}

function officeAgent(cwd: string): unknown {
  const id = SessionId(`office-composition-${String(Math.random())}`);
  const session = Session.create(id, [], { version: 0, id, createdAt: 0, cwd });
  session.append("turn/start", { turn: 1 });
  session.append("step/start", { turn: 1, step: 1 });
  return { session };
}

function authorizationResponse(override: Record<string, unknown> = {}): Response {
  return Response.json({
    deviceCode,
    expiresIn: 600,
    interval: 2,
    userCode: "ABCD-EFGH",
    verificationUriComplete: "/cli-login?userCode=ABCD-EFGH",
    ...override,
  });
}

function pending(override: Partial<PendingWorkspaceGrant> = {}): PendingWorkspaceGrant {
  return {
    state: "pending",
    deviceCode,
    expiresAt: fixedNow + 600_000,
    origin,
    userCode: "ABCD-EFGH",
    verificationUrl: `${origin}/cli-login?userCode=ABCD-EFGH`,
    ...override,
  };
}

function authenticated(override: Partial<AuthenticatedWorkspaceGrant> = {}): AuthenticatedWorkspaceGrant {
  return {
    state: "authenticated",
    cookie,
    origin,
    subject: { id: "stored-user", name: "Stored User" },
    ...override,
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

async function waitForAbort(signal: AbortSignal | null | undefined): Promise<void> {
  if (signal?.aborted === true) return;
  await new Promise<void>((resolve) => signal?.addEventListener("abort", () => resolve(), { once: true }));
}

function parseFailureEnvelope(message: string): unknown {
  return JSON.parse(message.slice(message.indexOf("{")));
}

interface ControlledDispatch {
  readonly name: string;
  readonly arguments: Record<string, unknown>;
  readonly before?: () => void;
}

class ControlledCodeRuntime extends CodeRuntime {
  public readonly language = "typescript";
  public readonly isolation = "fixture";
  public dispatches: ControlledDispatch[] = [];
  public discoveredTools: string[] = [];

  public override async run(request: CodeRunRequest): Promise<CodeRunResult> {
    const tools = request.bindings.find(({ global }) => global === "tools")?.functions;
    if (tools === undefined) return { logs: [], error: { kind: "exception", message: "missing tools binding" } };
    this.discoveredTools = Object.keys(tools);
    const value: CodeJsonValue[] = [];
    for (const dispatch of this.dispatches) {
      dispatch.before?.();
      const binding = tools[dispatch.name];
      if (binding === undefined) {
        return { logs: [], error: { kind: "exception", message: `missing binding ${dispatch.name}` } };
      }
      try {
        value.push(await binding(dispatch.arguments));
      } catch (error) {
        value.push({ error: error instanceof Error ? error.message : "tool call failed" });
      }
    }
    return { logs: [], value };
  }
}

class MemoryCredentials extends CredentialProvider {
  private record: CredentialRecord | undefined;
  public beforeNextModify: (() => void) | undefined;
  public deleteFailure: Error | undefined;
  public deleteGate: Promise<void> | undefined;
  public deleteStarted = false;
  public modifyStarted = false;
  public readFailure: Error | undefined;
  public readGate: Promise<void> | undefined;
  public readStarted = false;

  public seed(record: CredentialRecord | undefined): void {
    this.record = record;
  }

  public resetObservations(): void {
    this.deleteStarted = false;
    this.modifyStarted = false;
    this.readStarted = false;
  }

  public override async readRecord(_key: CredentialKey): Promise<CredentialRecord | undefined> {
    this.readStarted = true;
    await this.readGate;
    if (this.readFailure !== undefined) throw this.readFailure;
    return this.record;
  }

  public override async modifyRecord(
    _key: CredentialKey,
    mutate: (current: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>,
  ): Promise<CredentialRecord | undefined> {
    this.modifyStarted = true;
    this.beforeNextModify?.();
    this.beforeNextModify = undefined;
    const next = await mutate(this.record);
    if (next !== undefined) this.record = next;
    return this.record;
  }

  public override async deleteRecord(_key: CredentialKey): Promise<void> {
    this.deleteStarted = true;
    await this.deleteGate;
    if (this.deleteFailure !== undefined) return Promise.reject(this.deleteFailure);
    this.record = undefined;
  }

  public override resolve(_ref: CredentialRef): Promise<ResolvedCredential | undefined> { return Promise.resolve(undefined); }
  public override describe(_ref: CredentialRef): Promise<CredentialInfo> { return Promise.resolve({ configured: false, writable: true }); }
  public override set(_ref: CredentialRef, _value: string): Promise<void> { return Promise.resolve(); }
  public override unset(_ref: CredentialRef): Promise<void> { return Promise.resolve(); }
  public override describeRecord(_key: CredentialKey): Promise<CredentialRecordInfo> {
    return Promise.resolve(this.record === undefined
      ? { configured: false, writable: true }
      : { configured: true, kind: this.record.kind, writable: true });
  }
  public override listRecords(): Promise<readonly CredentialRecordEntry[]> { return Promise.resolve([]); }
}
