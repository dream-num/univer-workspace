import { compileFunction, createContext, runInContext } from "node:vm";
import {
  createStandardHeadlessUniverFacade,
  createStandardHeadlessUniverFactory,
} from "@univer-cli/headless-univer";
import { UniverInstanceType } from "@univerjs/core";
import { WorkspaceApplicationError, workspaceError } from "./errors.js";
import type {
  WorkspaceTypstMaterializeInput,
  WorkspaceTypstMaterializeResult,
  WorkspaceTypstMaterializer,
} from "./typst.js";

const UNIT_LIFECYCLE_METHODS = new Set<PropertyKey>([
  "createBase",
  "createBoard",
  "createWorkbook",
  "createPresentation",
  "createUniverSheet",
  "disposeUnit",
]);

interface DocumentFacade {
  save(): unknown;
}

interface TypstFacade {
  createDocument(data: Readonly<Record<string, unknown>>): DocumentFacade;
  getDocument(unitId: string): DocumentFacade | null;
}

export interface HeadlessWorkspaceTypstMaterializerOptions {
  readonly license?: string;
}

/** Workspace adapter that turns a target-neutral Facade program into complete Doc UnitData. */
export class HeadlessWorkspaceTypstMaterializer implements WorkspaceTypstMaterializer {
  public constructor(
    private readonly options: HeadlessWorkspaceTypstMaterializerOptions = {},
  ) {}

  public async materialize(
    input: WorkspaceTypstMaterializeInput,
  ): Promise<WorkspaceTypstMaterializeResult> {
    input.signal?.throwIfAborted();
    let univer: Awaited<ReturnType<ReturnType<typeof createStandardHeadlessUniverFactory>>>;
    try {
      univer = await createStandardHeadlessUniverFactory({
        license: this.options.license ?? "",
      })({
        unitId: input.targetUnitId,
        unitType: UniverInstanceType.UNIVER_DOC,
      });
    } catch (error) {
      throw this.projectFailure(error, input.signal);
    }
    let result: WorkspaceTypstMaterializeResult | undefined;
    let failed = false;
    let failure: unknown;
    try {
      input.signal?.throwIfAborted();
      const facade = createStandardHeadlessUniverFacade(univer) as unknown as TypstFacade;
      const createdUnitIds: string[] = [];
      let createDocumentCalls = 0;
      const guarded = new Proxy(facade, {
        get(target, property, receiver) {
          if (property === "createDocument") {
            return (data: unknown): DocumentFacade => {
              createDocumentCalls += 1;
              const documentData = isRecord(data) ? data : undefined;
              const id = nonEmptyString(documentData?.["id"]);
              if (id !== undefined) createdUnitIds.push(id);
              if (
                documentData === undefined ||
                createDocumentCalls !== 1 ||
                id !== input.targetUnitId
              ) {
                throw workspaceError(
                  "workspace-typst-runtime-contract",
                  `Typst program must create exactly one Doc named ${input.targetUnitId}.`,
                  { createdUnitIds },
                );
              }
              return target.createDocument(documentData);
            };
          }
          if (UNIT_LIFECYCLE_METHODS.has(property)) {
            return () => {
              throw workspaceError(
                "workspace-typst-runtime-contract",
                `Typst materialization cannot call ${String(property)}.`,
              );
            };
          }
          return Reflect.get(target, property, receiver) as unknown;
        },
      });
      await executeInDeterministicContext(input.javascript, guarded);
      input.signal?.throwIfAborted();
      if (
        createDocumentCalls !== 1 ||
        createdUnitIds.length !== 1 ||
        createdUnitIds[0] !== input.targetUnitId
      ) {
        throw workspaceError(
          "workspace-typst-runtime-contract",
          `Typst program must create exactly one Doc named ${input.targetUnitId}.`,
          { createdUnitIds },
        );
      }
      const document = facade.getDocument(input.targetUnitId);
      if (document === null) {
        throw workspaceError(
          "workspace-typst-runtime-contract",
          `Typst program did not leave Doc ${input.targetUnitId} in the runtime.`,
        );
      }
      input.signal?.throwIfAborted();
      const saved = document.save();
      input.signal?.throwIfAborted();
      if (!isRecord(saved) || saved["id"] !== input.targetUnitId) {
        throw workspaceError(
          "workspace-typst-runtime-contract",
          "Typst program did not produce complete Doc UnitData.",
          { saved },
        );
      }
      // A newly materialized Workspace Unit starts at revision 1 regardless of the ephemeral
      // headless runtime's local revision counter.
      const initialData: Readonly<Record<string, unknown>> = {
        ...saved,
        id: input.targetUnitId,
        rev: 1,
      };
      const name = nonEmptyString(initialData["name"]) ?? nonEmptyString(initialData["title"]);
      result = { initialData, ...(name === undefined ? {} : { name }) };
    } catch (error) {
      failed = true;
      failure = this.projectFailure(error, input.signal);
    }
    try {
      univer.dispose();
    } catch (error) {
      if (!failed) {
        failed = true;
        failure = this.projectFailure(error, input.signal);
      }
    }
    if (failed) throw failure;
    return result!;
  }

  private projectFailure(error: unknown, signal: AbortSignal | undefined): unknown {
    if (signal?.aborted === true) {
      try {
        signal.throwIfAborted();
      } catch (reason) {
        return reason;
      }
    }
    if (this.options.license === undefined || error instanceof WorkspaceApplicationError) {
      return error;
    }
    return workspaceError(
      "workspace-typst-runtime-contract",
      "Typst materialization failed inside the disposable Doc runtime.",
    );
  }
}

async function executeInDeterministicContext(
  javascript: string,
  facade: TypstFacade,
): Promise<void> {
  const nextUint32 = createRandom(stableSeed(javascript));
  const context = createContext({ __workspaceTypstNextUint32: nextUint32 });
  runInContext(INSTALL_DETERMINISTIC_RANDOM, context);
  const execute = compileFunction(javascript, ["univerAPI"], { parsingContext: context });
  await execute(facade);
}

const INSTALL_DETERMINISTIC_RANDOM = `
  ((nextUint32) => {
    Reflect.deleteProperty(globalThis, "__workspaceTypstNextUint32");
    Object.defineProperty(Math, "random", {
      configurable: true,
      value: () => nextUint32() / 4294967296,
      writable: true,
    });
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: Object.freeze({
        getRandomValues(view) {
          if (view === null) return view;
          const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
          for (let index = 0; index < bytes.length; index += 1) {
            bytes[index] = nextUint32() & 255;
          }
          return view;
        },
      }),
      writable: false,
    });
  })(globalThis.__workspaceTypstNextUint32);
`;

function createRandom(initialSeed: number): () => number {
  let state = initialSeed;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state;
  };
}

function stableSeed(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 0x01000193);
  }
  return hash === 0 ? 0x9e3779b9 : hash >>> 0;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
