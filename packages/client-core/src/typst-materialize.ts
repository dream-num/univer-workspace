import { createStandardHeadlessUniverFactory } from "@univer-cli/headless-univer";
import { materializeDocProgram } from "@univer-cli/doc-markdown-facade/node";
import type {
  WorkspaceTypstMaterializeInput,
  WorkspaceTypstMaterializeResult,
  WorkspaceTypstMaterializer,
} from "./typst.js";

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

async function withDeterministicRandom<Result>(
  seedSource: string,
  operation: () => Promise<Result>,
): Promise<Result> {
  const originalRandom = Object.getOwnPropertyDescriptor(Math, "random");
  const cryptoObject = globalThis.crypto;
  const originalGetRandomValues = Object.getOwnPropertyDescriptor(cryptoObject, "getRandomValues");
  const nextUint32 = createRandom(stableSeed(seedSource));
  Object.defineProperty(Math, "random", {
    configurable: true,
    value: () => nextUint32() / 4_294_967_296,
    writable: true,
  });
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
    if (originalRandom === undefined) delete (Math as { random?: unknown }).random;
    else Object.defineProperty(Math, "random", originalRandom);
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
