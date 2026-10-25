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
