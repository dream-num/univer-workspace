import {
  createStandardHeadlessUniverFacade,
  createStandardHeadlessUniverFactory,
} from "@univer-cli/headless-univer";
import { UniverInstanceType } from "@univerjs/core";
import { workspaceError } from "../../errors.js";

const UNIT_LIFECYCLE_METHODS = new Set<PropertyKey>([
  "createBase",
  "createBoard",
  "createWorkbook",
  "createPresentation",
  "createUniverSheet",
  "disposeUnit",
]);

export interface WorkspaceTypstMaterializeInput {
  readonly javascript: string;
  readonly targetUnitId: string;
}

export interface WorkspaceTypstMaterializeResult {
  readonly initialData: Readonly<Record<string, unknown>>;
  readonly name?: string;
}

export interface WorkspaceTypstMaterializer {
  materialize(input: WorkspaceTypstMaterializeInput): Promise<WorkspaceTypstMaterializeResult>;
}

interface DocumentFacade {
  save(): unknown;
}

interface TypstFacade {
  createDocument(data: Readonly<Record<string, unknown>>): DocumentFacade;
  getDocument(unitId: string): DocumentFacade | null;
}

/** Workspace adapter that turns a target-neutral Facade program into complete Doc UnitData. */
export class HeadlessWorkspaceTypstMaterializer implements WorkspaceTypstMaterializer {
  public async materialize(
    input: WorkspaceTypstMaterializeInput,
  ): Promise<WorkspaceTypstMaterializeResult> {
    const univer = await createStandardHeadlessUniverFactory({ license: "" })({
      unitId: input.targetUnitId,
      unitType: UniverInstanceType.UNIVER_DOC,
    });
    try {
      const facade = createStandardHeadlessUniverFacade(univer) as unknown as TypstFacade;
      const createdUnitIds: string[] = [];
      const guarded = new Proxy(facade, {
        get(target, property, receiver) {
          if (property === "createDocument") {
            return (data: Readonly<Record<string, unknown>>): DocumentFacade => {
              const id = nonEmptyString(data["id"]);
              if (id !== undefined) createdUnitIds.push(id);
              return target.createDocument(data);
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
      await withDeterministicRandom(input.javascript, async () => {
        const execute = new Function("univerAPI", input.javascript) as (
          api: TypstFacade,
        ) => Promise<unknown>;
        await execute(guarded);
      });
      if (createdUnitIds.length !== 1 || createdUnitIds[0] !== input.targetUnitId) {
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
      const saved = document.save();
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
      return { initialData, ...(name === undefined ? {} : { name }) };
    } finally {
      univer.dispose();
    }
  }
}

async function withDeterministicRandom<Result>(
  seedSource: string,
  operation: () => Promise<Result>,
): Promise<Result> {
  const originalRandom = Math.random;
  const cryptoObject = globalThis.crypto;
  const originalGetRandomValues = Object.getOwnPropertyDescriptor(cryptoObject, "getRandomValues");
  const nextUint32 = createRandom(stableSeed(seedSource));
  Math.random = () => nextUint32() / 4_294_967_296;
  let cryptoPatched = false;
  try {
    Object.defineProperty(cryptoObject, "getRandomValues", {
      configurable: true,
      value: <ArrayType extends ArrayBufferView | null>(view: ArrayType): ArrayType => {
        if (view === null) return view;
        const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
        for (let index = 0; index < bytes.length; index += 1) bytes[index] = nextUint32() & 255;
        return view;
      },
    });
    cryptoPatched = true;
    return await operation();
  } finally {
    Math.random = originalRandom;
    if (cryptoPatched) {
      if (originalGetRandomValues === undefined)
        delete (cryptoObject as { getRandomValues?: unknown }).getRandomValues;
      else Object.defineProperty(cryptoObject, "getRandomValues", originalGetRandomValues);
    }
  }
}

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
