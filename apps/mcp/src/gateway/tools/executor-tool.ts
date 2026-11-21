import { createHash } from "node:crypto";
import { jobHandleSchema, type JobRecord } from "../jobs/model.js";
import type { WorkspaceSubject } from "@univerjs/univer-workspace-client-core/product";
import { z } from "zod";
import type { GatewayConfig } from "../../shared/config.js";
import type {
  ExecutorRequest,
  ExecutorResult,
  OpSpec,
  OpName,
  PayloadDirection,
} from "../../shared/executor-protocol.js";
import { ExecutorCallError } from "../../shared/errors.js";
import type { Logger } from "pino";
import type { UsageAccumulator } from "../../shared/usage.js";
import {
  createAffinityTransport,
  MemoryEpochStore,
  type EpochStore,
} from "../../executor-fc/index.js";
import type { Authentication } from "../auth.js";
import { callExecutor, type ExecutorConnection } from "../executor/client.js";
import { issueGrant } from "../executor/grants.js";
import { ExecutorRouter } from "../executor/router.js";
import type { ToolContext, ToolDefinition, ToolResult } from "./definition.js";

// Key order must not change the fingerprint; undefined members vanish as they do in JSON.
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([name, item]) => `${JSON.stringify(name)}:${canonicalJson(item)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

type MappedResult = Pick<ToolResult, "output" | "waiting"> & { repo?: string | null };

const linkBrand = Symbol("ExecutorLink");
export interface ExecutorLink {
  readonly [linkBrand]: true;
}
const links = new WeakMap<
  ExecutorLink,
  { connection: ExecutorConnection | null; usage: UsageAccumulator }
>();

export function createExecutorLinks(
  config: GatewayConfig["executor"],
  router = config ? new ExecutorRouter(config.urls) : null,
  epochs: EpochStore = defaultEpochs(config),
  logger?: Pick<Logger, "info">,
) {
  const transport =
    config === null ? null : createAffinityTransport({ epochs, ...(logger ? { logger } : {}) });
  return (
    auth: Authentication,
    user: WorkspaceSubject,
    requestId: string,
    deadlineAt: number,
    usage: UsageAccumulator,
  ): ExecutorLink => {
    const link: ExecutorLink = Object.freeze({ [linkBrand]: true as const });
    links.set(link, {
      connection:
        config && router && transport
          ? {
              router,
              transport,
              executorToken: config.executorToken,
              grant: issueGrant(auth, user),
              requestId,
              deadlineAt,
            }
          : null,
      usage,
    });
    return link;
  };
}

/**
 * Memory unless the gateway built the store from `MCP_EXECUTOR_EPOCH_STORE`. A Redis store has a
 * lifecycle (connect, close), so it must come from `gateway/executor/epochs.ts`.
 */
function defaultEpochs(config: GatewayConfig["executor"]): EpochStore {
  if (config?.epochs?.store === "redis")
    throw new Error(
      "A Redis executor epoch store must be created by the gateway and passed to createExecutorLinks",
    );
  return new MemoryEpochStore();
}

export function executorTool<
  A extends z.ZodObject,
  I extends z.ZodType,
  O extends z.ZodObject,
  P extends PayloadDirection,
>(
  definition: Omit<ToolDefinition, "run" | "inputSchema" | "outputSchema"> & {
    inputSchema: A;
    job?: { tool: JobRecord["tool"]; key(args: z.output<A>): string | undefined };
    op: OpSpec<I, O, P> & { readonly name: OpName };
    outputSchema?: z.ZodObject;
    response?(
      result: ExecutorResult<OpSpec<I, O, P>>,
      args: z.output<A>,
      context: ToolContext,
    ): Promise<MappedResult> | MappedResult;
    request(
      args: z.output<A>,
      context: ToolContext,
    ): ExecutorRequest<OpSpec<I, O, P>> | Promise<ExecutorRequest<OpSpec<I, O, P>>>;
  },
): ToolDefinition {
  const { op, request, response, outputSchema, job, ...tool } = definition;
  const finishedSchema = outputSchema ?? op.output;
  return {
    ...tool,
    executorOperations: [op.name],
    outputSchema: job ? z.union([finishedSchema, jobHandleSchema]) : finishedSchema,
    async run(context, args) {
      const link = context.executor ? links.get(context.executor) : undefined;
      const parsed = tool.inputSchema.parse(args);
      const execute = async (deadlineAt?: number) => {
        const connection = link?.connection;
        const result = await callExecutor(
          connection && deadlineAt !== undefined
            ? { ...connection, deadlineAt }
            : (connection ?? null),
          op,
          await request(parsed, context),
        ).catch((error) => {
          if (error instanceof ExecutorCallError && error.meta) link?.usage.addOp(error.meta);
          throw error;
        });
        link?.usage.addOp(result.meta);
        const mapped: MappedResult = response
          ? await response(result, parsed, context)
          : { output: result.output };
        if (
          !finishedSchema.safeParse(mapped.output).success ||
          (mapped.waiting && !finishedSchema.safeParse(mapped.waiting.output).success)
        )
          throw new Error(`Tool ${tool.name} returned output that violates its output schema.`);
        return {
          output: mapped.output,
          repo: "repo" in mapped ? (mapped.repo ?? null) : (result.meta.repo ?? null),
          ...(mapped.waiting ? { waiting: mapped.waiting } : {}),
        };
      };
      if (job && context.jobs)
        return context.jobs.run({
          userId: context.user.id,
          tool: job.tool,
          key: job.key(parsed),
          fingerprint: createHash("sha256").update(canonicalJson(parsed)).digest("hex"),
          grantExpiresAt: link?.connection?.grant.expiresAt,
          execute,
          onDeferred: (completion) => context.onDeferredJob?.(completion),
        });
      return execute();
    },
  };
}
