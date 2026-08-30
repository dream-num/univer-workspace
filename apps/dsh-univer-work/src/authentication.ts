import type { Context } from "@deepseek-ai/cordis";
import "@deepseek-ai/dsh-skill";
import type { CredentialProvider } from "@deepseek-ai/dsh-credentials";
import { HarnessError } from "@deepseek-ai/dsh-llm";
import {
  defineTool,
  type PreToolDecision,
  type ToolDefinition,
  type ToolRunContext,
} from "@deepseek-ai/dsh-tools";
import {
  completeCliLogin,
  HeadlessWorkspaceTypstMaterializer,
  logout,
  startCliLogin,
  whoami,
  WorkspaceCompileTypstFeature,
  WorkspaceCompileSvgFeature,
  WorkspaceContentExecutionFeature,
  WorkspaceContentSource,
  WorkspaceUnitExchangeFeature,
  WorkspaceUnitFeature,
  WorkspaceApplicationError,
  WorkspaceHttp,
  type WorkspaceUnitExchangeDependencies,
  type WorkspaceSubject,
} from "@univerjs/univer-workspace-client-core";
import {
  AuthMutationQueue,
  grantRecord,
  parseWorkspaceGrantRecord,
  resolveAuthenticatedWorkspaceHttp,
  sameWorkspaceGrant,
  subjectExposesSecrets,
  WORKSPACE_CREDENTIAL_KEY,
  WorkspaceAuthenticationRequiredError,
  WorkspaceCredentialError,
  type AuthenticatedWorkspaceGrant,
  type PendingWorkspaceGrant,
  type WorkspaceGrant,
} from "./authentication-state.js";
import {
  assertWorkspaceFileTransferComposition,
  registerWorkspaceFileTransferTools,
} from "./file-transfer.js";
import {
  WorkspaceContentRuntimeGenerations,
  type WorkspaceContentRuntimeGenerationOptions,
} from "./content-runtime-generation.js";
import { registerWorkspaceContentTools } from "./content-tools.js";
import {
  loadBundledWorkspaceSkills,
  registerBundledWorkspaceSkills,
} from "./bundled-skills.js";
import {
  createWorkspaceDiscoveryDatasets,
  registerWorkspaceApiDiscoveryTools,
  type WorkspaceDiscoveryDatasetOptions,
} from "./discovery-tools.js";
import { registerWorkspaceSpaceNodeTools } from "./space-node.js";
import { registerWorkspaceOfficeTools } from "./office-tools.js";
import {
  registerWorkspaceRenderTools,
  WORKSPACE_RENDER_PAGE_ROOT,
  type WorkspaceRenderOptions,
} from "./render-tools.js";
import {
  registerWorkspaceSvgTools,
  type WorkspaceSvgToolDependencies,
} from "./svg-tools.js";
import { WorkspaceToolOwner } from "./tool-owner.js";
import { registerWorkspaceWorktreeUnitTools } from "./worktree-unit.js";
import {
  MAX_TYPST_GENERATED_JAVASCRIPT_BYTES,
  MAX_TYPST_RESULT_DEPTH,
  MAX_TYPST_UNIT_DATA_BYTES,
  MAX_TYPST_VISIBLE_RESULT_BYTES,
  registerWorkspaceTypstTools,
} from "./typst-tools.js";
import coreSkill from "../skills/core/SKILL.md?raw";

export interface WorkspaceAuthenticationOptions {
  readonly contentRuntime?: WorkspaceContentRuntimeGenerationOptions;
  readonly discovery?: WorkspaceDiscoveryDatasetOptions;
  readonly fetcher?: typeof fetch;
  readonly now?: () => number;
  readonly office?: Pick<WorkspaceUnitExchangeDependencies,
    "exportToBuffer" | "importBuffer" | "inspectSource" | "openSource" | "writeOutput">;
  readonly render?: WorkspaceRenderOptions;
  readonly svg?: Pick<WorkspaceSvgToolDependencies, "createFeature">;
}

const subjectSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: { type: "string", required: true },
    name: { type: "string", required: true },
  },
} as const;

const handoffSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    status: { type: "string", const: "authorization_required", required: true },
    origin: { type: "string", required: true },
    userCode: { type: "string", required: true },
    verificationUrl: { type: "string", required: true },
    expiresAt: { type: "integer", required: true },
  },
} as const;

const completionSchema = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      properties: {
        status: { type: "string", const: "authorization_pending", required: true },
        origin: { type: "string", required: true },
        userCode: { type: "string", required: true },
        verificationUrl: { type: "string", required: true },
        expiresAt: { type: "integer", required: true },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      properties: {
        status: { type: "string", enum: ["authorization_expired", "authorization_missing"], required: true },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      properties: {
        status: { type: "string", const: "authenticated", required: true },
        origin: { type: "string", required: true },
        subject: { ...subjectSchema, required: true },
      },
    },
  ],
} as const;

const authenticatedSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    status: { type: "string", const: "authenticated", required: true },
    subject: { ...subjectSchema, required: true },
  },
} as const;

const logoutSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    status: { type: "string", const: "local_credentials_cleared", required: true },
  },
} as const;

function closeParameterRoot(
  definition: ToolDefinition,
  keys: readonly string[],
): ToolDefinition {
  return {
    ...definition,
    parameters: { ...definition.parameters, additionalProperties: false },
    execute: async (args, exec) => {
      validateAuthenticationArguments(args, keys);
      return await definition.execute(args, exec);
    },
  };
}

function validateAuthenticationArguments(value: unknown, keys: readonly string[]): void {
  if (
    typeof value !== "object"
    || value === null
    || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value) as object | null)
    || Reflect.ownKeys(value).length !== keys.length
    || !keys.every((key) => Object.hasOwn(value, key))
  ) {
    throw new HarnessError("Workspace authentication arguments are invalid.", "INVALID_ARGS");
  }
}

export function mountWorkspaceAuthentication(
  ctx: Context,
  options: WorkspaceAuthenticationOptions = {},
): void {
  ctx.effect(
    () => {
      const bundledWorkspaceSkills = loadBundledWorkspaceSkills();
      const discovery = createWorkspaceDiscoveryDatasets(options.discovery);
      assertWorkspaceFileTransferComposition(ctx);
      const toolOwner = new WorkspaceToolOwner();
      const owner = new WorkspaceAuthenticationOwner(ctx.credentials, options, toolOwner);
      const contentRuntimes = new WorkspaceContentRuntimeGenerations(
        ctx.credentials,
        options.contentRuntime,
      );
      const units = new WorkspaceUnitFeature((signal) => owner.authenticatedHttp(signal));
      const typst = new WorkspaceCompileTypstFeature({
        materializer: {
          materialize: async (input) => await new HeadlessWorkspaceTypstMaterializer({
            license: contentRuntimes.resolveLicense(input.signal),
          }).materialize(input),
        },
        units,
      });
      const office = new WorkspaceUnitExchangeFeature({
        createUnit: async (input, signal) => await units.create(input, signal),
        resolveRuntimeTarget: async (input, signal) =>
          await new WorkspaceContentSource(
            await owner.authenticatedHttp(signal),
          ).resolveRuntimeTarget(input, signal),
        runtime: {
          exportUnitData: async (input) => await contentRuntimes.run(
            input.signal ?? new AbortController().signal,
            async (runtime) => await runtime.exportUnitData(input),
          ),
        },
        ...options.office,
      });
      const renderRegistration = registerWorkspaceRenderTools(ctx, {
        owner: toolOwner,
        ...(options.render === undefined ? {} : { options: options.render }),
        resolveAuthenticatedHttp: (signal) => owner.authenticatedHttp(signal),
        runtimes: contentRuntimes,
      });
      const svgRegistration = registerWorkspaceSvgTools(ctx, {
        owner: toolOwner,
        createFeature: options.svg?.createFeature ?? ((signal) => new WorkspaceCompileSvgFeature({
          contentExecution: {
            executeSlide: async (input) => await contentRuntimes.run(signal, async (runtime) => {
              const http = await owner.authenticatedHttp(signal);
              signal.throwIfAborted();
              return await new WorkspaceContentExecutionFeature(
                new WorkspaceContentSource(http),
                runtime,
              ).executeSlide(input);
            }),
          },
          env: process.env,
          license: contentRuntimes.resolveLicense(signal),
          renderPageRoot: WORKSPACE_RENDER_PAGE_ROOT,
        })),
      });
      const unregister = [
        ctx.tools.register(closeParameterRoot(defineTool({
          name: "workspace_auth_start",
          description: "Start one Workspace browser approval. Relay the returned URL and code, then stop until the user confirms approval.",
          parameters: {
            origin: {
              type: "string",
              required: true,
              description: "Workspace HTTP(S) origin without path, query, credentials, or fragment.",
            },
          },
          output: {
            schema: handoffSchema,
            render: (_args, value) => [{
              type: "text",
              text: `Open ${value.verificationUrl} and enter ${value.userCode}. Wait for the user to confirm approval before calling workspace_auth_complete. Approval expires at ${renderExpiry(value.expiresAt)}.`,
            }],
          },
          execute: (args, exec) => owner.execute("start", exec, (signal) => owner.start(args.origin, signal)),
        }), ["origin"])),
        ctx.tools.register(closeParameterRoot(defineTool({
          name: "workspace_auth_complete",
          description: "Perform one Workspace browser-approval exchange only after the user says approval is complete. Never poll.",
          parameters: {},
          output: {
            schema: completionSchema,
            render: (_args, value) => [{ type: "text", text: renderCompletion(value) }],
          },
          execute: (_args, exec) => owner.execute("complete", exec, (signal) => owner.complete(signal)),
        }), [])),
        ctx.tools.register(closeParameterRoot(defineTool({
          name: "workspace_auth_whoami",
          description: "Read the current server-authoritative Workspace User.",
          parameters: {},
          output: {
            schema: authenticatedSchema,
            render: (_args, value) => [{
              type: "text",
              text: `Authenticated Workspace User: ${value.subject.name} (${value.subject.id}).`,
            }],
          },
          isConcurrencySafe: () => true,
          execute: (_args, exec) => owner.execute("whoami", exec, (signal) => owner.currentUser(signal)),
        }), [])),
        ctx.tools.register(closeParameterRoot(defineTool({
          name: "workspace_auth_logout",
          description: "Clear the current Workspace authentication after explicit human approval.",
          parameters: {},
          output: {
            schema: logoutSchema,
            render: () => [{ type: "text", text: "Local Workspace credentials were cleared." }],
          },
          execute: (_args, exec) => owner.execute("logout", exec, (signal) => owner.logout(signal)),
        }), [])),
        ctx.on("tools/pre-execute", async (exec, next): Promise<PreToolDecision> =>
          exec.name === "workspace_auth_logout"
            ? (validateAuthenticationArguments(exec.arguments, []), {
                kind: "ask",
                reason: "Logging out removes the current Workspace credential.",
              })
            : await next()),
        ...registerWorkspaceSpaceNodeTools(ctx, {
          owner: toolOwner,
          resolveAuthenticatedHttp: (signal) => owner.authenticatedHttp(signal),
        }),
        ...registerWorkspaceWorktreeUnitTools(ctx, {
          owner: toolOwner,
          resolveAuthenticatedHttp: (signal) => owner.authenticatedHttp(signal),
        }),
        ...registerWorkspaceFileTransferTools(ctx, {
          owner: toolOwner,
          resolveAuthenticatedHttp: (signal) => owner.authenticatedHttp(signal),
        }),
        ...registerWorkspaceContentTools(ctx, {
          owner: toolOwner,
          resolveAuthenticatedHttp: (signal) => owner.authenticatedHttp(signal),
          runtimes: contentRuntimes,
        }),
        ...registerWorkspaceOfficeTools(ctx, {
          office,
          owner: toolOwner,
        }),
        ...registerWorkspaceTypstTools(ctx, {
          owner: toolOwner,
          compile: async (input, owned) => await typst.execute({
            bundlePath: input.bundlePath,
            maxGeneratedJavascriptBytes: MAX_TYPST_GENERATED_JAVASCRIPT_BYTES,
            maxVisibleResultBytes: MAX_TYPST_VISIBLE_RESULT_BYTES,
            maxVisibleResultDepth: MAX_TYPST_RESULT_DEPTH,
            ...(input.previewDirectory === undefined ? {} : { previewDir: input.previewDirectory }),
            signal: owned.signal,
          }),
          apply: async (input, owned) => await typst.execute({
            apply: {
              spaceId: input.args.space_id,
              worktreeId: input.args.worktree_id,
              ...(input.args.parent_node_id === undefined
                ? {}
                : { parentNodeId: input.args.parent_node_id }),
              ...(input.args.idempotency_key === undefined
                ? {}
                : { idempotencyKey: input.args.idempotency_key }),
            },
            bundlePath: input.bundlePath,
            maxGeneratedJavascriptBytes: MAX_TYPST_GENERATED_JAVASCRIPT_BYTES,
            maxUnitDataBytes: MAX_TYPST_UNIT_DATA_BYTES,
            maxUnitDataDepth: MAX_TYPST_RESULT_DEPTH,
            maxVisibleResultBytes: MAX_TYPST_VISIBLE_RESULT_BYTES,
            maxVisibleResultDepth: MAX_TYPST_RESULT_DEPTH,
            ...(input.previewDirectory === undefined ? {} : { previewDir: input.previewDirectory }),
            signal: owned.signal,
          }),
        }),
        ...registerWorkspaceApiDiscoveryTools(ctx, {
          datasets: discovery,
          owner: toolOwner,
        }),
        contentRuntimes.listen(ctx),
        ctx.skills.register({
          name: "core",
          description: "Operate remote Univer Workspace authentication, Space/Node discovery, isolated Worktrees, Units, and review handoff.",
          source: "bundled",
          content: coreSkill,
        }),
        registerBundledWorkspaceSkills(ctx, bundledWorkspaceSkills),
      ];
      return async () => {
        toolOwner.stopAccepting();
        renderRegistration.stopAccepting();
        svgRegistration.stopAccepting();
        for (const dispose of unregister.reverse()) dispose();
        renderRegistration.unregister();
        svgRegistration.unregister();
        toolOwner.abort();
        await Promise.all([
          toolOwner.drain(),
          renderRegistration.drain(),
          svgRegistration.drain(),
          contentRuntimes.close(),
        ]);
        renderRegistration.dispose();
        svgRegistration.dispose();
      };
    },
    "dsh-univer-work authentication owner",
  );
}

type Operation = "start" | "complete" | "whoami" | "logout";

const stableWorkspaceCodes = new Set([
  "CLI_AUTHORIZATION_EXPIRED",
  "CLI_AUTHORIZATION_INVALID",
  "CLI_AUTHORIZATION_UNAVAILABLE",
  "workspace-authentication-required",
  "workspace-cli-authorization-expired",
  "workspace-invalid-response",
  "workspace-origin-invalid",
  "workspace-origin-mismatch",
  "workspace-redirect-refused",
  "workspace-request-invalid",
  "workspace-result-unknown",
]);

class WorkspaceAuthenticationOwner {
  private readonly mutationQueue = new AuthMutationQueue();

  public constructor(
    private readonly credentials: CredentialProvider,
    private readonly options: WorkspaceAuthenticationOptions,
    private readonly owner: WorkspaceToolOwner,
  ) {}

  public async execute<Result>(
    operation: Operation,
    exec: ToolRunContext,
    body: (signal: AbortSignal) => Promise<Result>,
  ): Promise<Result> {
    try {
      return await this.owner.run(exec, async ({ signal }) => await body(signal));
    } catch (error) {
      throw sanitize(operation, error);
    }
  }

  public async start(origin: string, signal: AbortSignal): Promise<{
    readonly status: "authorization_required";
    readonly origin: string;
    readonly userCode: string;
    readonly verificationUrl: string;
    readonly expiresAt: number;
  }> {
    const normalizedOrigin = new WorkspaceHttp({ origin, role: "client" }).origin;
    return await this.mutationQueue.run(async () => {
      throwIfAborted(signal);
      let current = await this.readGrant(signal);
      if (current?.state === "pending" && current.expiresAt <= this.now()) {
        await this.credentials.deleteRecord(WORKSPACE_CREDENTIAL_KEY);
        throwIfAborted(signal);
        current = undefined;
      }
      if (current?.state === "pending") {
        if (current.origin !== normalizedOrigin) throw authenticationConflict();
        return handoff("authorization_required", current);
      }
      if (current?.state === "authenticated") throw authenticationConflict();
      const started = await startCliLogin(this.http(normalizedOrigin), () => this.now(), signal);
      throwIfAborted(signal);
      const pending = parseWorkspaceGrantRecord(grantRecord({
        state: "pending",
        ...started,
      })) as PendingWorkspaceGrant;
      throwIfAborted(signal);
      await this.commit(current, pending, signal);
      return handoff("authorization_required", pending);
    });
  }

  public async complete(signal: AbortSignal): Promise<
    | { readonly status: "authorization_missing" | "authorization_expired" }
    | { readonly status: "authorization_pending"; readonly origin: string; readonly userCode: string; readonly verificationUrl: string; readonly expiresAt: number }
    | { readonly status: "authenticated"; readonly origin: string; readonly subject: WorkspaceSubject }
  > {
    return await this.mutationQueue.run(async () => {
      throwIfAborted(signal);
      const current = await this.readGrant(signal);
      if (current === undefined) return { status: "authorization_missing" };
      if (current.state === "authenticated") return authenticated(current);
      if (current.expiresAt <= this.now()) {
        await this.credentials.deleteRecord(WORKSPACE_CREDENTIAL_KEY);
        throwIfAborted(signal);
        return { status: "authorization_expired" };
      }
      const result = await completeCliLogin(this.http(current.origin), current, () => this.now(), signal);
      throwIfAborted(signal);
      if (result.status === "pending") return handoff("authorization_pending", current);
      if (subjectExposesSecrets(result.subject, [current.deviceCode, result.cookie])) {
        throw invalidResponse();
      }
      let next: AuthenticatedWorkspaceGrant;
      try {
        next = parseWorkspaceGrantRecord(grantRecord({
          state: "authenticated",
          origin: result.origin,
          cookie: result.cookie,
          subject: result.subject,
        })) as AuthenticatedWorkspaceGrant;
      } catch (error) {
        if (error instanceof WorkspaceCredentialError) throw invalidResponse();
        throw error;
      }
      throwIfAborted(signal);
      await this.commit(current, next, signal);
      return authenticated(next);
    });
  }

  public async currentUser(signal: AbortSignal): Promise<{
    readonly status: "authenticated";
    readonly subject: WorkspaceSubject;
  }> {
    const http = await this.authenticatedHttp(signal);
    const result = await whoami(http, signal);
    throwIfAborted(signal);
    if (http.subjectExposesCredential(result.subject)) throw invalidResponse();
    return { status: "authenticated", subject: result.subject };
  }

  public async logout(signal: AbortSignal): Promise<{ readonly status: "local_credentials_cleared" }> {
    return await this.mutationQueue.run(async () => {
      let remoteFailure: unknown;
      try {
        let current: WorkspaceGrant | undefined;
        try {
          current = await this.readGrant();
        } catch (error) {
          if (!(error instanceof WorkspaceCredentialError)) throw error;
        }
        if (current?.state === "authenticated") {
          await logout(this.http(current.origin, current.cookie), signal);
        }
      } catch (error) {
        remoteFailure = error;
      }
      try {
        await this.credentials.deleteRecord(WORKSPACE_CREDENTIAL_KEY);
      } catch {
        throw failure("logout");
      }
      if (remoteFailure !== undefined) throw remoteFailure;
      return { status: "local_credentials_cleared" };
    });
  }

  public async authenticatedHttp(signal?: AbortSignal): ReturnType<typeof resolveAuthenticatedWorkspaceHttp> {
    return await resolveAuthenticatedWorkspaceHttp(
      this.credentials,
      "client",
      this.options.fetcher,
      signal,
    );
  }

  private async commit(
    expected: WorkspaceGrant | undefined,
    replacement: WorkspaceGrant,
    signal: AbortSignal,
  ): Promise<void> {
    let committed = false;
    await this.credentials.modifyRecord(WORKSPACE_CREDENTIAL_KEY, async (record) => {
      throwIfAborted(signal);
      let observed: WorkspaceGrant | undefined;
      try {
        observed = parseWorkspaceGrantRecord(record);
      } catch (error) {
        if (error instanceof WorkspaceCredentialError) return undefined;
        throw error;
      }
      if (!sameWorkspaceGrant(observed, expected)) return undefined;
      committed = true;
      return grantRecord(replacement);
    });
    if (!committed) throw stateConflict();
  }

  private async readGrant(signal?: AbortSignal): Promise<WorkspaceGrant | undefined> {
    const record = await this.credentials.readRecord(WORKSPACE_CREDENTIAL_KEY);
    if (signal !== undefined) throwIfAborted(signal);
    return parseWorkspaceGrantRecord(record);
  }

  private http(origin: string, cookie?: string): WorkspaceHttp {
    return new WorkspaceHttp({
      origin,
      role: "client",
      ...(cookie === undefined ? {} : { cookie }),
      ...(this.options.fetcher === undefined ? {} : { fetcher: this.options.fetcher }),
    });
  }

  private now(): number {
    return (this.options.now ?? Date.now)();
  }
}

class AuthenticationToolError extends HarnessError {}

function handoff<Status extends "authorization_required" | "authorization_pending">(
  status: Status,
  pending: PendingWorkspaceGrant,
): {
  readonly status: Status;
  readonly origin: string;
  readonly userCode: string;
  readonly verificationUrl: string;
  readonly expiresAt: number;
} {
  return {
    status,
    origin: pending.origin,
    userCode: pending.userCode,
    verificationUrl: pending.verificationUrl,
    expiresAt: pending.expiresAt,
  };
}

function authenticated(grant: AuthenticatedWorkspaceGrant): {
  readonly status: "authenticated";
  readonly origin: string;
  readonly subject: WorkspaceSubject;
} {
  return { status: "authenticated", origin: grant.origin, subject: grant.subject };
}

function renderCompletion(value:
  | { readonly status: "authorization_missing" | "authorization_expired" }
  | { readonly status: "authorization_pending"; readonly origin: string; readonly userCode: string; readonly verificationUrl: string; readonly expiresAt: number }
  | { readonly status: "authenticated"; readonly origin: string; readonly subject: WorkspaceSubject },
): string {
  if (value.status === "authorization_missing") return "No pending Workspace browser approval exists. Start one first.";
  if (value.status === "authorization_expired") return "The Workspace browser approval expired. Start a new one.";
  if (value.status === "authorization_pending") {
    return `Approval is still pending. Open ${value.verificationUrl}, enter ${value.userCode}, and stop until the user confirms approval.`;
  }
  return "subject" in value
    ? `Authenticated Workspace User: ${value.subject.name} (${value.subject.id}).`
    : "Workspace authentication did not complete.";
}

function renderExpiry(expiresAt: number): string {
  const date = new Date(expiresAt);
  return Number.isNaN(date.getTime()) ? String(expiresAt) : date.toISOString();
}

function sanitize(operation: Operation, error: unknown): HarnessError {
  if (error instanceof AuthenticationToolError) return error;
  if (error instanceof WorkspaceApplicationError) {
    return failure(operation, stableWorkspaceCodes.has(error.code) ? error.code : undefined);
  }
  if (error instanceof WorkspaceAuthenticationRequiredError) return authenticationRequired();
  if (error instanceof WorkspaceCredentialError) {
    return new AuthenticationToolError("The stored Workspace credential is invalid.", "workspace-credential-invalid");
  }
  return failure(operation);
}

function failure(operation: Operation, code = `workspace-auth-${operation}-failed`): AuthenticationToolError {
  return new AuthenticationToolError(`Workspace authentication ${operation} failed.`, code);
}

function authenticationConflict(): AuthenticationToolError {
  return new AuthenticationToolError(
    "Complete or log out the current Workspace authentication before starting another origin.",
    "workspace-authentication-conflict",
  );
}

function authenticationRequired(): AuthenticationToolError {
  return new AuthenticationToolError(
    "Workspace authentication is required.",
    "workspace-authentication-required",
  );
}

function stateConflict(): AuthenticationToolError {
  return new AuthenticationToolError(
    "Workspace authentication state changed before it could be stored.",
    "workspace-authentication-state-conflict",
  );
}

function invalidResponse(): AuthenticationToolError {
  return new AuthenticationToolError(
    "Workspace returned an invalid authentication response.",
    "workspace-invalid-response",
  );
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason;
}
