import { AsyncLocalStorage } from "node:async_hooks";
import { createStandardHeadlessUniverFactory } from "@univer-cli/headless-univer";
import { materializeDocProgram } from "@univer-cli/doc-markdown-facade/node";
import type {
  WorkspaceTypstMaterializeInput,
  WorkspaceTypstMaterializeResult,
  WorkspaceTypstMaterializer,
} from "./typst.js";

const randomContext = new AsyncLocalStorage<() => number>();
let activeRandomContexts = 0;
let restoreRandom: (() => void) | undefined;

/** Workspace adapter that turns a target-neutral Facade program into complete Doc UnitData. */
export class HeadlessWorkspaceDocumentMaterializer implements WorkspaceTypstMaterializer {
  public constructor(
    private readonly format: "Typst" | "Markdown" = "Typst",
    private readonly license: string = "",
  ) {}
  public async materialize(
    input: WorkspaceTypstMaterializeInput,
  ): Promise<WorkspaceTypstMaterializeResult> {
    const materialized = await withDeterministicRandom(
      input.javascript,
      async () =>
        await materializeDocProgram(input, {
          createUniver: createStandardHeadlessUniverFactory({ license: this.license }),
        }),
    );
    // Workspace creates Units at revision 1 independently of the ephemeral runtime revision.
    const initialData: Readonly<Record<string, unknown>> = { ...materialized.data, rev: 1 };
    const name = nonEmptyString(initialData["name"]) ?? nonEmptyString(initialData["title"]);
    return {
      initialData,
      ...(name === undefined ? {} : { name }),
      ...(this.format === "Markdown" ? { value: materialized.value } : {}),
    };
  }
}

export class HeadlessWorkspaceTypstMaterializer extends HeadlessWorkspaceDocumentMaterializer {}

/**
 * Native identities must repeat for idempotent creation, but Agent hosts are long-lived and run
 * concurrent sessions. Only the calling async context sees seeded values; the global dispatch is
 * installed once for overlapping calls and removed by the last one.
 */
async function withDeterministicRandom<Result>(
  seedSource: string,
  operation: () => Promise<Result>,
): Promise<Result> {
  if (activeRandomContexts === 0) restoreRandom = installRandomDispatch();
  activeRandomContexts += 1;
  try {
    return await randomContext.run(createRandom(stableSeed(seedSource)), operation);
  } finally {
    activeRandomContexts -= 1;
    if (activeRandomContexts === 0) {
      restoreRandom?.();
      restoreRandom = undefined;
    }
  }
}

function installRandomDispatch(): () => void {
  const originalRandom = Object.getOwnPropertyDescriptor(Math, "random");
  const cryptoObject = globalThis.crypto;
  const originalGetRandomValues = Object.getOwnPropertyDescriptor(cryptoObject, "getRandomValues");
  const random = Math.random;
  const getRandomValues = cryptoObject.getRandomValues;
  const restoreMath = (): void => {
    if (originalRandom === undefined) delete (Math as { random?: unknown }).random;
    else Object.defineProperty(Math, "random", originalRandom);
  };
  Object.defineProperty(Math, "random", {
    configurable: true,
    value: () => {
      const nextUint32 = randomContext.getStore();
      return nextUint32 === undefined ? random() : nextUint32() / 4_294_967_296;
    },
    writable: true,
  });
  try {
    Object.defineProperty(cryptoObject, "getRandomValues", {
      configurable: true,
      value: <ArrayType extends ArrayBufferView | null>(view: ArrayType): ArrayType => {
        const nextUint32 = randomContext.getStore();
        if (nextUint32 === undefined) {
          return getRandomValues.call(cryptoObject, view as never) as ArrayType;
        }
        if (view === null) return view;
        const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
        for (let index = 0; index < bytes.length; index += 1) bytes[index] = nextUint32() & 255;
        return view;
      },
    });
  } catch (error) {
    restoreMath();
    throw error;
  }
  return () => {
    restoreMath();
    if (originalGetRandomValues === undefined)
      delete (cryptoObject as { getRandomValues?: unknown }).getRandomValues;
    else Object.defineProperty(cryptoObject, "getRandomValues", originalGetRandomValues);
  };
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
