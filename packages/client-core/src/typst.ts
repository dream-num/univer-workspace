import { randomUUID } from "node:crypto";
import { types } from "node:util";
import {
  compileDocTypstBundle,
  DaCTypstTranslationError,
  DocTypstFacadeError,
  type CompileDocTypstBundleOptions,
  type CompileDocTypstBundleResult,
} from "@univer-cli/doc-typst-facade";
import { measureCanonicalJson } from "./canonical-json.js";
import { WorkspaceApplicationError, workspaceError } from "./errors.js";
import type { WorkspaceUnitFeature } from "./unit.js";
import type { WorkspaceUnit } from "./worktree-model.js";

export interface WorkspaceCompileTypstInput {
  readonly apply?: {
    readonly idempotencyKey?: string;
    readonly parentNodeId?: string;
    readonly spaceId: string;
    readonly worktreeId: string;
  };
  readonly bundlePath: string;
  readonly maxGeneratedJavascriptBytes?: number;
  readonly maxUnitDataBytes?: number;
  readonly maxUnitDataDepth?: number;
  readonly maxVisibleResultBytes?: number;
  readonly maxVisibleResultDepth?: number;
  readonly previewDir?: string;
  readonly signal?: AbortSignal;
}

export interface WorkspaceCompileTypstResult extends CompileDocTypstBundleResult {
  readonly committed: boolean;
  readonly unit?: WorkspaceUnit;
}

export interface WorkspaceTypstMaterializeInput {
  readonly javascript: string;
  readonly signal?: AbortSignal;
  readonly targetUnitId: string;
}

export interface WorkspaceTypstMaterializeResult {
  readonly initialData: Readonly<Record<string, unknown>>;
  readonly name?: string;
}

export interface WorkspaceTypstMaterializer {
  materialize(input: WorkspaceTypstMaterializeInput): Promise<WorkspaceTypstMaterializeResult>;
}

export interface WorkspaceTypstDependencyFailure {
  readonly code:
    | "workspace-typst-bundle-invalid"
    | "workspace-typst-compile-failed"
    | "workspace-typst-preview-failed";
  readonly diagnostics?: unknown;
}

const bundleErrorCodes = new Set([
  "DOC_TYPST_MANIFEST_INVALID",
  "SAC_DAC_PATH_INVALID",
  "SAC_DAC_PATH_OUTSIDE_SOURCE_ROOT",
]);
const compileErrorCodes = new Set(["DOC_TYPST_PRINTER_FAILED", "SAC_DAC_TRANSLATION_FAILED"]);
const previewErrorCodes = new Set(["SAC_DAC_PREVIEW_RENDER_UNAVAILABLE"]);

export function projectWorkspaceTypstDependencyFailure(
  error: unknown,
): WorkspaceTypstDependencyFailure | undefined {
  const prototype = typeof error === "object" && error !== null
    ? Object.getPrototypeOf(error) as unknown
    : undefined;
  if (prototype !== DocTypstFacadeError.prototype && prototype !== DaCTypstTranslationError.prototype) {
    return undefined;
  }
  const code = (error as DocTypstFacadeError).code;
  if (bundleErrorCodes.has(code)) return { code: "workspace-typst-bundle-invalid" };
  if (previewErrorCodes.has(code)) return { code: "workspace-typst-preview-failed" };
  if (!compileErrorCodes.has(code)) return undefined;
  return {
    code: "workspace-typst-compile-failed",
    ...(prototype === DaCTypstTranslationError.prototype
      ? { diagnostics: (error as DaCTypstTranslationError).diagnostics }
      : {}),
  };
}

export interface WorkspaceCompileTypstDependencies {
  readonly compile?: (
    bundlePath: string,
    options?: CompileDocTypstBundleOptions,
  ) => Promise<CompileDocTypstBundleResult>;
  readonly materializer: WorkspaceTypstMaterializer;
  readonly units: Pick<WorkspaceUnitFeature, "create">;
}

/** Workspace orchestration: compile once, validate, materialize, then create one staged Doc. */
export class WorkspaceCompileTypstFeature {
  private readonly compile: NonNullable<WorkspaceCompileTypstDependencies["compile"]>;

  public constructor(private readonly dependencies: WorkspaceCompileTypstDependencies) {
    this.compile = dependencies.compile ?? compileDocTypstBundle;
  }

  public async execute(input: WorkspaceCompileTypstInput): Promise<WorkspaceCompileTypstResult> {
    validateLimits(input);
    input.signal?.throwIfAborted();
    const compileOptions: CompileDocTypstBundleOptions =
      input.previewDir === undefined ? {} : { previewDir: input.previewDir };
    let compiled: CompileDocTypstBundleResult;
    try {
      compiled = await this.compile(input.bundlePath, compileOptions);
    } catch (error) {
      input.signal?.throwIfAborted();
      throw error;
    }
    input.signal?.throwIfAborted();
    validateCompiledResult(compiled, input);
    if (input.apply === undefined) return { ...compiled, committed: false };

    const errors = compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error");
    if (errors.length > 0) {
      throw workspaceError(
        "workspace-typst-diagnostics",
        `Typst compilation contains ${String(errors.length)} error diagnostic(s); no Unit was created.`,
        { diagnostics: errors },
      );
    }
    input.signal?.throwIfAborted();
    const materializeInput: WorkspaceTypstMaterializeInput = {
      javascript: compiled.javascript,
      targetUnitId: compiled.targetUnitId,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    };
    const materialized = await this.dependencies.materializer.materialize(materializeInput);
    input.signal?.throwIfAborted();
    const unitDataMeasurement = input.maxUnitDataBytes === undefined && input.maxUnitDataDepth === undefined
      ? materialized.initialData
      : canonicalUnitData(materialized.initialData);
    validateCanonicalLimit(
      unitDataMeasurement,
      input.maxUnitDataBytes,
      input.maxUnitDataDepth,
      "unit-data",
    );
    input.signal?.throwIfAborted();
    const name = materialized.name ?? compiled.title;
    const hasVisibleLimits = input.maxVisibleResultBytes !== undefined
      || input.maxVisibleResultDepth !== undefined;
    if (hasVisibleLimits && name.trim() === "") throw typstLimit("visible-result-json");
    const createIdentity = hasVisibleLimits
      ? {
          idempotencyKey: input.apply.idempotencyKey ?? randomUUID(),
          name,
          parentNodeId: input.apply.parentNodeId ?? null,
          spaceId: input.apply.spaceId,
          type: "doc" as const,
          worktreeId: input.apply.worktreeId,
        }
      : undefined;
    if (createIdentity !== undefined) {
      validateCanonicalLimit(
        createIdentity,
        input.maxVisibleResultBytes,
        input.maxVisibleResultDepth,
        "visible-result",
      );
    }
    input.signal?.throwIfAborted();
    const createInput = {
      name,
      spaceId: input.apply.spaceId,
      type: "doc" as const,
      worktreeId: input.apply.worktreeId,
      initialData: materialized.initialData,
      ...(input.apply.parentNodeId === undefined
        ? {}
        : { parentNodeId: input.apply.parentNodeId }),
      ...(createIdentity !== undefined
        ? { idempotencyKey: createIdentity.idempotencyKey }
        : input.apply.idempotencyKey === undefined
          ? {}
          : { idempotencyKey: input.apply.idempotencyKey }),
    };
    let unit: WorkspaceUnit;
    try {
      unit = input.signal === undefined
        ? await this.dependencies.units.create(createInput)
        : await this.dependencies.units.create(createInput, input.signal);
    } catch (error) {
      if (createIdentity === undefined || !isTypstCreateOutcomeError(error)) throw error;
      throw workspaceError(
        error.code,
        "Workspace Unit create completed without a safely confirmed result.",
        { request: createIdentity },
      );
    }
    return { ...compiled, committed: true, unit };
  }
}

function canonicalUnitData(
  value: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  try {
    const projected = projectCanonicalUnitData(value, new Set());
    if (typeof projected !== "object" || projected === null || Array.isArray(projected)) {
      throw new TypeError();
    }
    return projected as Readonly<Record<string, unknown>>;
  } catch {
    throw typstLimit("unit-data-json");
  }
}

const OMIT_UNIT_DATA_VALUE = Symbol("omit-unit-data-value");

function projectCanonicalUnitData(value: unknown, visiting: Set<object>): unknown {
  if (value === undefined) return OMIT_UNIT_DATA_VALUE;
  if (
    value === null
    || typeof value === "string"
    || typeof value === "boolean"
    || (typeof value === "number" && Number.isFinite(value))
  ) return value;
  if (typeof value !== "object" || types.isProxy(value) || visiting.has(value)) {
    throw new TypeError();
  }
  const keys = Reflect.ownKeys(value);
  if (Array.isArray(value)) {
    if (keys.length !== value.length + 1) throw new TypeError();
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !("value" in descriptor)) throw new TypeError();
      if (key === "length") {
        if (descriptor.enumerable || descriptor.value !== value.length) throw new TypeError();
        continue;
      }
      if (
        typeof key !== "string"
        || !/^(?:0|[1-9][0-9]*)$/u.test(key)
        || Number(key) >= value.length
        || descriptor.enumerable !== true
      ) throw new TypeError();
    }
    const result = new Array<unknown>(value.length);
    visiting.add(value);
    try {
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index))!;
        const projected = projectCanonicalUnitData(descriptor.value, visiting);
        result[index] = projected === OMIT_UNIT_DATA_VALUE ? null : projected;
      }
      return result;
    } finally {
      visiting.delete(value);
    }
  }
  if (!isPlainUnitDataRecord(value)) throw new TypeError();
  for (const key of keys) {
    if (typeof key !== "string") throw new TypeError();
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor) || descriptor.enumerable !== true) {
      throw new TypeError();
    }
  }
  const result = Object.create(null) as Record<string, unknown>;
  visiting.add(value);
  try {
    for (const key of keys as string[]) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)! as PropertyDescriptor & { value: unknown };
      const projected = projectCanonicalUnitData(descriptor.value, visiting);
      if (projected !== OMIT_UNIT_DATA_VALUE) {
        Object.defineProperty(result, key, {
          configurable: true,
          enumerable: true,
          value: projected,
          writable: true,
        });
      }
    }
    return result;
  } finally {
    visiting.delete(value);
  }
}

function isPlainUnitDataRecord(value: object): boolean {
  const prototype = Object.getPrototypeOf(value) as object | null;
  return prototype === null
    || prototype === Object.prototype
    || isSafeCrossRealmObjectPrototype(prototype);
}

const hostObjectPrototypeKeys = Reflect.ownKeys(Object.prototype);

function isSafeCrossRealmObjectPrototype(prototype: object): boolean {
  if (types.isProxy(prototype) || Object.getPrototypeOf(prototype) !== null) return false;
  const keys = Reflect.ownKeys(prototype);
  if (
    keys.length !== hostObjectPrototypeKeys.length
    || keys.some((key) => !hostObjectPrototypeKeys.includes(key))
  ) return false;
  return hostObjectPrototypeKeys.every((key) => {
    const candidate = Object.getOwnPropertyDescriptor(prototype, key);
    const host = Object.getOwnPropertyDescriptor(Object.prototype, key)!;
    if (
      candidate === undefined
      || candidate.configurable !== host.configurable
      || candidate.enumerable !== host.enumerable
      || ("value" in candidate) !== ("value" in host)
    ) return false;
    if ("value" in candidate && "value" in host) {
      return candidate.writable === host.writable
        && sameNativeIntrinsic(candidate.value, host.value);
    }
    return !("value" in candidate) && !("value" in host)
      && sameNativeIntrinsic(candidate.get, host.get)
      && sameNativeIntrinsic(candidate.set, host.set);
  });
}

function sameNativeIntrinsic(candidate: unknown, host: unknown): boolean {
  if (typeof host !== "function") return Object.is(candidate, host);
  if (typeof candidate !== "function" || types.isProxy(candidate)) return false;
  for (const key of ["name", "length"] as const) {
    const candidateDescriptor = Object.getOwnPropertyDescriptor(candidate, key);
    const hostDescriptor = Object.getOwnPropertyDescriptor(host, key)!;
    if (
      candidateDescriptor === undefined
      || !("value" in candidateDescriptor)
      || !("value" in hostDescriptor)
      || !Object.is(candidateDescriptor.value, hostDescriptor.value)
      || candidateDescriptor.configurable !== hostDescriptor.configurable
      || candidateDescriptor.enumerable !== hostDescriptor.enumerable
      || candidateDescriptor.writable !== hostDescriptor.writable
    ) return false;
  }
  return Function.prototype.toString.call(candidate) === Function.prototype.toString.call(host);
}

const typstCreateOutcomeCodes = new Set([
  "workspace-invalid-response",
  "workspace-result-mismatch",
  "workspace-result-unknown",
]);

function isTypstCreateOutcomeError(error: unknown): error is WorkspaceApplicationError {
  return typeof error === "object"
    && error !== null
    && Object.getPrototypeOf(error) === WorkspaceApplicationError.prototype
    && typstCreateOutcomeCodes.has((error as WorkspaceApplicationError).code);
}

function validateCompiledResult(
  compiled: CompileDocTypstBundleResult,
  input: WorkspaceCompileTypstInput,
): void {
  const javascriptBytes = Buffer.byteLength(compiled.javascript);
  if (
    input.maxGeneratedJavascriptBytes !== undefined
    && javascriptBytes > input.maxGeneratedJavascriptBytes
  ) {
    throw typstLimit(
      "generated-javascript-bytes",
      input.maxGeneratedJavascriptBytes,
      javascriptBytes,
    );
  }
  validateCanonicalLimit(
    {
      diagnostics: compiled.diagnostics,
      previews: compiled.previews,
      targetUnitId: compiled.targetUnitId,
      title: compiled.title,
    },
    input.maxVisibleResultBytes,
    input.maxVisibleResultDepth,
    "visible-result",
  );
}

function validateCanonicalLimit(
  value: unknown,
  maxBytes: number | undefined,
  maxDepth: number | undefined,
  kind: "unit-data" | "visible-result",
): void {
  if (maxBytes === undefined && maxDepth === undefined) return;
  let measurement: ReturnType<typeof measureCanonicalJson>;
  try {
    measurement = measureCanonicalJson(value);
  } catch {
    throw typstLimit(`${kind}-json`);
  }
  if (maxDepth !== undefined && measurement.depth > maxDepth) {
    throw typstLimit(`${kind}-depth`, maxDepth, measurement.depth);
  }
  if (maxBytes !== undefined && measurement.bytes > maxBytes) {
    throw typstLimit(`${kind}-bytes`, maxBytes, measurement.bytes);
  }
}

function validateLimits(input: WorkspaceCompileTypstInput): void {
  for (const [kind, limit] of [
    ["generated-javascript-bytes", input.maxGeneratedJavascriptBytes],
    ["unit-data-bytes", input.maxUnitDataBytes],
    ["visible-result-bytes", input.maxVisibleResultBytes],
  ] as const) {
    if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1)) {
      throw typstLimit(kind, limit);
    }
  }
  for (const [kind, limit] of [
    ["unit-data-depth", input.maxUnitDataDepth],
    ["visible-result-depth", input.maxVisibleResultDepth],
  ] as const) {
    if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 0)) {
      throw typstLimit(kind, limit);
    }
  }
}

function typstLimit(kind: string, limit?: number, actual?: number) {
  return workspaceError(
    "workspace-typst-limit-exceeded",
    "Workspace Typst output exceeds the configured limit.",
    { kind, ...(limit === undefined ? {} : { limit }), ...(actual === undefined ? {} : { actual }) },
  );
}
