import { jobHandleSchema } from "../jobs/model.js";
import type { WorkspaceSubject } from "@univerjs/univer-workspace-client-core/product";
import { z } from "zod";
import type { GatewayConfig } from "../../shared/config.js";
import type {
  ExecutorRequest,
  ExecutorResult,
  OpSpec,
  PayloadDirection,
} from "../../shared/executor-protocol.js";
import { ExecutorCallError } from "../../shared/errors.js";
import type { UsageAccumulator } from "../../shared/usage.js";
import type { Authentication } from "../auth.js";
import { callExecutor, type ExecutorConnection } from "../executor/client.js";
import { issueGrant } from "../executor/grants.js";
import { ExecutorRouter } from "../executor/router.js";
import type { ToolContext, ToolDefinition } from "./definition.js";

const linkBrand = Symbol("ExecutorLink");
export interface ExecutorLink {
  readonly [linkBrand]: true;
}
const links = new WeakMap<
  ExecutorLink,
  { connection: ExecutorConnection | null; usage: UsageAccumulator }
>();

export function createExecutorLinks(config: GatewayConfig["executor"]) {
  const router = config ? new ExecutorRouter(config.urls) : null;
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
        config && router
          ? {
              router,
              internalToken: config.internalToken,
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

export function executorTool<
  A extends z.ZodObject,
  I extends z.ZodType,
  O extends z.ZodObject,
  P extends PayloadDirection,
>(
  definition: Omit<ToolDefinition, "run" | "inputSchema" | "outputSchema"> & {
    inputSchema: A;
    job?: { tool: "import" | "export"; key(args: z.output<A>): string | undefined };
    op: OpSpec<I, O, P>;
    outputSchema?: z.ZodObject;
    response?(
      result: ExecutorResult<OpSpec<I, O, P>>,
      args: z.output<A>,
      context: ToolContext,
    ): Promise<{ output: object; repo?: string | null }> | { output: object; repo?: string | null };
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
        const mapped = response
          ? await response(result, parsed, context)
          : { output: result.output };
        if (!finishedSchema.safeParse(mapped.output).success)
          throw new Error(`Tool ${tool.name} returned output that violates its output schema.`);
        return {
          output: mapped.output,
          repo: "repo" in mapped ? (mapped.repo ?? null) : (result.meta.repo ?? null),
        };
      };
      if (job && context.jobs)
        return context.jobs.run({
          userId: context.user.id,
          tool: job.tool,
          key: job.key(parsed),
          execute,
          onDeferred: (completion) => context.onDeferredJob?.(completion),
        });
      return execute();
    },
  };
}
