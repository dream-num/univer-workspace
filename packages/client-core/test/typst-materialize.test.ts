import { beforeEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({
  createUniver: vi.fn(),
  factory: vi.fn(),
  materialize: vi.fn(),
}));
vi.mock("@univer-cli/headless-univer", () => ({
  createStandardHeadlessUniverFactory: sdk.factory,
}));
vi.mock("@univer-cli/doc-markdown-facade/node", () => ({
  materializeDocProgram: sdk.materialize,
}));
import {
  HeadlessWorkspaceDocumentMaterializer,
  HeadlessWorkspaceTypstMaterializer,
} from "../src/typst-materialize.js";

beforeEach(() => {
  vi.clearAllMocks();
  sdk.factory.mockReturnValue(sdk.createUniver);
  sdk.materialize.mockResolvedValue({
    data: { id: "doc", name: "Runtime paper", rev: 17 },
    value: { sourceMap: [{ id: "intro", paragraphIds: ["native"] }] },
  });
});

const input = { javascript: 'univerAPI.createDocument({ id: "doc" });', targetUnitId: "doc" };

describe("Workspace document materialization adapter", () => {
  it("delegates execution and native validation to the shared SDK with the configured factory", async () => {
    const materializer = new HeadlessWorkspaceDocumentMaterializer("Markdown", "runtime-license");
    const result = await materializer.materialize(input);
    expect(sdk.factory).toHaveBeenCalledWith({ license: "runtime-license" });
    expect(sdk.materialize).toHaveBeenCalledWith(input, { createUniver: sdk.createUniver });
    expect(result).toEqual({
      initialData: { id: "doc", name: "Runtime paper", rev: 1 },
      name: "Runtime paper",
      value: { sourceMap: [{ id: "intro", paragraphIds: ["native"] }] },
    });
  });

  it.each([
    ["saved name", { id: "doc", name: " Name ", title: "Title" }, " Name "],
    ["saved title", { id: "doc", name: " ", title: " Title " }, " Title "],
    ["no name", { id: "doc", name: "", title: 1 }, undefined],
  ] as const)("uses %s without rewriting it", async (_, data, name) => {
    sdk.materialize.mockResolvedValueOnce({ data });
    const result = await new HeadlessWorkspaceTypstMaterializer().materialize(input);
    expect(result.name).toBe(name);
    expect(result.initialData).toEqual({ ...data, rev: 1 });
    expect(result).not.toHaveProperty("value");
  });

  it("retains deterministic identity generation for idempotent Workspace creation", async () => {
    const mathBefore = Object.getOwnPropertyDescriptor(Math, "random");
    const cryptoBefore = Object.getOwnPropertyDescriptor(globalThis.crypto, "getRandomValues");
    sdk.materialize.mockImplementation(async () => {
      const backing = new Uint8Array([7, 7, 7, 7, 7, 7]);
      const view = new Uint8Array(backing.buffer, 2, 3);
      const returned = crypto.getRandomValues(view);
      return {
        data: {
          id: "doc",
          bytes: Array.from(backing),
          random: Math.random(),
          sameView: returned === view,
        },
      };
    });
    const materializer = new HeadlessWorkspaceTypstMaterializer();
    const first = await materializer.materialize(input);
    expect(await materializer.materialize(input)).toEqual(first);
    expect(first.initialData["sameView"]).toBe(true);
    expect((first.initialData["bytes"] as number[]).slice(0, 2)).toEqual([7, 7]);
    expect((first.initialData["bytes"] as number[]).slice(5)).toEqual([7]);
    expect(Object.getOwnPropertyDescriptor(Math, "random")).toEqual(mathBefore);
    expect(Object.getOwnPropertyDescriptor(globalThis.crypto, "getRandomValues")).toEqual(
      cryptoBefore,
    );
  });

  it("scopes seeded randomness to overlapping calls and restores globals after the last", async () => {
    const entropy = vi.spyOn(Math, "random").mockReturnValue(0.25);
    const mathBefore = Object.getOwnPropertyDescriptor(Math, "random");
    const cryptoBefore = Object.getOwnPropertyDescriptor(globalThis.crypto, "getRandomValues");
    const gates = new Map<string, () => void>();
    const entered = new Map<string, () => void>();
    const reached = (javascript: string): Promise<void> =>
      new Promise((resolve) => entered.set(javascript, resolve));
    sdk.materialize.mockImplementation(async ({ javascript }: { javascript: string }) => {
      const before = Math.random();
      entered.get(javascript)?.();
      await new Promise<void>((resolve) => gates.set(javascript, resolve));
      return { data: { id: "doc", before, after: Math.random() } };
    });
    const materializer = new HeadlessWorkspaceTypstMaterializer();
    const soloEntered = reached("a");
    const solo = materializer.materialize({ ...input, javascript: "a" });
    await soloEntered;
    gates.get("a")?.();
    const expectedA = (await solo).initialData;

    const firstEntered = reached("a");
    const first = materializer.materialize({ ...input, javascript: "a" });
    await firstEntered;
    const secondEntered = reached("b");
    const second = materializer.materialize({ ...input, javascript: "b" });
    await secondEntered;

    // Another session running during materialization keeps real entropy.
    expect(Math.random()).toBe(0.25);

    gates.get("a")?.();
    expect((await first).initialData).toEqual(expectedA);
    expect(Object.getOwnPropertyDescriptor(Math, "random")).not.toEqual(mathBefore);
    gates.get("b")?.();
    await second;
    expect(Object.getOwnPropertyDescriptor(Math, "random")).toEqual(mathBefore);
    expect(Object.getOwnPropertyDescriptor(globalThis.crypto, "getRandomValues")).toEqual(
      cryptoBefore,
    );
    entropy.mockRestore();
  });

  it("preserves SDK execution errors and restores randomness after failure", async () => {
    const mathBefore = Object.getOwnPropertyDescriptor(Math, "random");
    const cryptoBefore = Object.getOwnPropertyDescriptor(globalThis.crypto, "getRandomValues");
    const failure = Object.assign(new Error("The program must create one target Doc."), {
      code: "DOC_PROGRAM_RUNTIME_CONTRACT",
    });
    sdk.materialize.mockRejectedValueOnce(failure);
    await expect(new HeadlessWorkspaceTypstMaterializer().materialize(input)).rejects.toBe(failure);
    expect(Object.getOwnPropertyDescriptor(Math, "random")).toEqual(mathBefore);
    expect(Object.getOwnPropertyDescriptor(globalThis.crypto, "getRandomValues")).toEqual(
      cryptoBefore,
    );
  });
});
