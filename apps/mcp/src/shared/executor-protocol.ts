import { z } from "zod";
import { opMetaSchema } from "./usage.js";

export const PROTOCOL_VERSION = 1;
const MiB = 1024 * 1024;
export const executorGrantSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("session"),
    userId: z.string().min(1),
    session: z
      .string()
      .min(1)
      .regex(/^[^\s;,]+$/),
    expiresAt: z.number().int().positive(),
  }),
]);
export type ExecutorGrant = z.infer<typeof executorGrantSchema>;
export type OpEffect = "read" | "write";
export type PayloadDirection = "none" | "request" | "response";
export interface RouteKey {
  readonly scope: string;
  readonly unitId: string | null;
}
export interface OpSpec<
  I extends z.ZodType = z.ZodType,
  O extends z.ZodObject = z.ZodObject,
  P extends PayloadDirection = PayloadDirection,
> {
  readonly name: string;
  readonly effect: OpEffect;
  readonly payload: P;
  readonly rerun: readonly ("revision" | "auth")[];
  readonly limits: {
    readonly requestBytes: number;
    readonly responseBytes: number;
    readonly budgetMs: number;
  };
  readonly input: I;
  readonly output: O;
  route(input: z.output<I>): RouteKey;
}
function defineOp<I extends z.ZodType, O extends z.ZodObject, const P extends PayloadDirection>(
  spec: OpSpec<I, O, P>,
): OpSpec<I, O, P> {
  return spec;
}

export const runtimeScope = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("trunk") }),
  z.object({ kind: z.literal("worktree"), worktreeId: z.string().min(1) }),
]);
export const inspectionTarget = z.enum([
  "workbook",
  "worksheet",
  "range",
  "document",
  "paragraph",
  "presentation",
  "slide",
  "base",
  "board",
  "board-element",
]);
export const inspectionOptions = z.object({
  target: inspectionTarget,
  selectors: z.array(z.string()).optional(),
  worksheet: z.string().optional(),
});
export const codeInput = z
  .string()
  .min(1)
  .refine((code) => Buffer.byteLength(code) <= 10 * MiB, "Code exceeds 10 MiB");

// Fits the gateway's 4 MiB JSON cap even when every UTF-8 byte needs JSON escaping.
export const htmlViewMaxBytes = 512 * 1024;
export const htmlViewInput = z
  .string()
  .refine(
    (html) => Buffer.byteLength(html, "utf8") <= htmlViewMaxBytes,
    "HTML exceeds the 512 KiB UTF-8 limit.",
  );

export const opSpecs = {
  "htmlView.validate": defineOp({
    name: "htmlView.validate",
    effect: "read",
    payload: "none",
    rerun: [],
    limits: { requestBytes: 4 * MiB, responseBytes: 64 * 1024, budgetMs: 30_000 },
    input: z.object({ html: htmlViewInput }),
    output: z.object({
      valid: z.literal(true),
      unitIds: z.array(z.string()),
      bindingCount: z.int().nonnegative(),
    }),
    route: () => ({ scope: "htmlView.validate", unitId: null }),
  }),
  "htmlView.create": defineOp({
    name: "htmlView.create",
    effect: "write",
    payload: "none",
    rerun: [],
    limits: { requestBytes: 4 * MiB, responseBytes: 64 * 1024, budgetMs: 30_000 },
    input: z.object({
      html: htmlViewInput,
      spaceId: z.string().min(1),
      name: z.string().min(1).max(255),
      parentNodeId: z.string().min(1).optional(),
      idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{16,200}$/),
    }),
    output: z
      .object({
        nodeId: z.string(),
        resourceId: z.string(),
        operationId: z.string(),
        workspaceUrl: z.url(),
      })
      .catchall(z.json()),
    route: (input) => ({ scope: "htmlView.create", unitId: input.idempotencyKey }),
  }),
  "exchange.import": defineOp({
    name: "exchange.import",
    effect: "write",
    payload: "request",
    rerun: [],
    limits: { requestBytes: 64 * MiB, responseBytes: 64 * 1024, budgetMs: 30_000 },
    input: z.object({
      worktreeId: z.string().min(1),
      spaceId: z.string().min(1),
      fileName: z.string().min(1).max(255),
      type: z.enum(["sheet", "base", "doc", "slide"]).optional(),
      name: z.string().optional(),
      parentNodeId: z.string().optional(),
      idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{16,200}$/),
    }),
    output: z.object({
      committed: z.literal(true),
      name: z.string(),
      nodeId: z.string(),
      resourceId: z.string(),
      sourcePath: z.string(),
      type: z.enum(["sheet", "base", "doc", "slide"]),
      unitId: z.string(),
      worktreeId: z.string(),
    }),
    route: (input) => ({ scope: "exchange.import", unitId: input.idempotencyKey }),
  }),
  "exchange.export": defineOp({
    name: "exchange.export",
    effect: "read",
    payload: "response",
    rerun: [],
    limits: { requestBytes: 64 * 1024, responseBytes: 128 * MiB, budgetMs: 30_000 },
    input: z.object({
      worktreeId: z.string().min(1),
      unitId: z.string().min(1),
      format: z.enum(["xlsx", "docx", "pptx"]),
    }),
    output: z.object({
      name: z.string(),
      type: z.enum(["sheet", "base", "doc", "slide"]),
      unitId: z.string(),
      worktreeId: z.string(),
    }),
    route: (input) => ({ scope: `worktree:${input.worktreeId}`, unitId: input.unitId }),
  }),
  "content.execute": defineOp({
    name: "content.execute",
    effect: "write",
    payload: "none",
    rerun: [],
    limits: { requestBytes: 12 * MiB, responseBytes: 8 * MiB, budgetMs: 30_000 },
    input: z.object({ worktreeId: z.string().min(1), unitId: z.string().min(1), code: codeInput }),
    output: z.object({
      committed: z.boolean(),
      revision: z.int().positive().optional(),
      status: z.string().optional(),
      value: z.json().optional(),
      valueTruncated: z.literal(true).optional(),
    }),
    route: (input) => ({ scope: `worktree:${input.worktreeId}`, unitId: input.unitId }),
  }),
  "content.inspect": defineOp({
    name: "content.inspect",
    effect: "read",
    payload: "none",
    rerun: [],
    limits: { requestBytes: 256 * 1024, responseBytes: 8 * MiB, budgetMs: 30_000 },
    input: inspectionOptions.extend({ scope: runtimeScope, unitId: z.string().min(1) }),
    output: z
      .object({
        kind: z.enum([
          "workbook",
          "worksheet",
          "worksheet-range",
          "document",
          "paragraph",
          "presentation",
          "slide",
          "base",
          "board",
          "board-element",
        ]),
        unitId: z.string().min(1),
      })
      .catchall(z.json()),
    route: (input) => ({
      scope: input.scope.kind === "trunk" ? "trunk" : `worktree:${input.scope.worktreeId}`,
      unitId: input.unitId,
    }),
  }),
  "diagnostics.probe": defineOp({
    name: "diagnostics.probe",
    effect: "read",
    payload: "none",
    rerun: [],
    limits: { requestBytes: 16 * 1024, responseBytes: 16 * 1024, budgetMs: 10_000 },
    input: z.object({}),
    output: z.object({
      whoami: z.object({ id: z.string(), name: z.string() }),
      ticket: z.boolean(),
      websocket: z.boolean(),
      transport: z.string(),
    }),
    route: () => ({ scope: "", unitId: null }),
  }),
} as const;
export type OpName = keyof typeof opSpecs;
export type AnyOp = (typeof opSpecs)[OpName];
export type OpInput<S extends { input: z.ZodType }> = z.output<S["input"]>;
export type OpOutput<S extends { output: z.ZodType }> = z.output<S["output"]>;
export type ExecutorRequest<S extends { input: z.ZodType; payload: PayloadDirection }> = {
  input: OpInput<S>;
} & (S["payload"] extends "request" ? { bytes: Uint8Array } : unknown);
export type ExecutorResult<S extends { output: z.ZodType; payload: PayloadDirection }> = {
  output: OpOutput<S>;
  meta: z.infer<typeof opMetaSchema>;
} & (S["payload"] extends "response" ? { bytes: Uint8Array } : unknown);
export function isOpName(name: string): name is OpName {
  return Object.hasOwn(opSpecs, name);
}

export const requestHeaderSchema = z.object({
  v: z.literal(PROTOCOL_VERSION),
  op: z.string(),
  requestId: z.string().regex(/^[a-zA-Z0-9._-]{1,128}$/),
  deadlineMs: z.int().positive().max(30_000),
  grant: executorGrantSchema,
  input: z.unknown(),
});
export type RequestHeader = z.infer<typeof requestHeaderSchema>;
export const wireErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  detail: z.json(),
  outcome: z.enum(["tool_error", "auth_error", "timeout", "internal_error"]),
});
export const responseHeaderSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), output: z.unknown(), meta: opMetaSchema }),
  z.object({ ok: z.literal(false), error: wireErrorSchema, meta: opMetaSchema }),
]);
