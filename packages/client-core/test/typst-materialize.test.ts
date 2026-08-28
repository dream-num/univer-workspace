import { beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  created: [] as Readonly<Record<string, unknown>>[],
  disposes: [] as ReturnType<typeof vi.fn>[],
  factoryError: undefined as unknown,
  factoryOptions: [] as unknown[],
  facade: undefined as unknown,
  getDocument: true,
  initInputs: [] as unknown[],
  saved: { id: "typst-doc", name: "Runtime paper", rev: 99 } as unknown,
  saveError: undefined as unknown,
}));

vi.mock("@univer-cli/headless-univer", () => ({
  createStandardHeadlessUniverFacade: () => fake.facade,
  createStandardHeadlessUniverFactory: (options: unknown) => {
    fake.factoryOptions.push(options);
    return async (input: unknown) => {
      fake.initInputs.push(input);
      if (fake.factoryError !== undefined) throw fake.factoryError;
      const dispose = vi.fn();
      fake.disposes.push(dispose);
      return { dispose };
    };
  },
}));

import { UniverInstanceType } from "@univerjs/core";
import { HeadlessWorkspaceTypstMaterializer } from "../src/index.js";

beforeEach(() => {
  fake.created.length = 0;
  fake.disposes.length = 0;
  fake.factoryError = undefined;
  fake.factoryOptions.length = 0;
  fake.getDocument = true;
  fake.initInputs.length = 0;
  fake.saved = { id: "typst-doc", name: "Runtime paper", rev: 99 };
  fake.saveError = undefined;
  const document = {
    save: vi.fn(() => {
      if (fake.saveError !== undefined) throw fake.saveError;
      return fake.saved;
    }),
  };
  fake.facade = {
    createDocument: vi.fn((data: Readonly<Record<string, unknown>>) => {
      fake.created.push(data);
      return document;
    }),
    getDocument: vi.fn(() => (fake.getDocument ? document : null)),
  };
});

describe("Headless Workspace Typst materializer", () => {
  it("creates one disposable standard Doc runtime and normalizes complete UnitData", async () => {
    fake.saved = {
      body: { dataStream: "hello" },
      extra: { nested: true },
      id: "typst-doc",
      name: "  Runtime paper  ",
      rev: 17,
    };
    await expect(materialize(createDocumentProgram("typst-doc"))).resolves.toEqual({
      initialData: {
        body: { dataStream: "hello" },
        extra: { nested: true },
        id: "typst-doc",
        name: "  Runtime paper  ",
        rev: 1,
      },
      name: "  Runtime paper  ",
    });
    expect(fake.factoryOptions).toEqual([{ license: "" }]);
    expect(fake.initInputs).toEqual([
      { unitId: "typst-doc", unitType: UniverInstanceType.UNIVER_DOC },
    ]);
    expect(fake.disposes).toHaveLength(1);
    expect(fake.disposes[0]).toHaveBeenCalledOnce();
  });

  it.each([
    ["saved name", { id: "typst-doc", name: " Name ", title: "Title" }, " Name "],
    ["saved title", { id: "typst-doc", name: " ", title: " Title " }, " Title "],
    ["no name", { id: "typst-doc", name: "", title: 1 }, undefined],
  ] as const)("uses %s without rewriting it", async (_, saved, expectedName) => {
    fake.saved = saved;
    const result = await materialize(createDocumentProgram("typst-doc"));
    expect(result.name).toBe(expectedName);
    expect(result.initialData).toEqual({ ...saved, id: "typst-doc", rev: 1 });
  });

  it.each([
    "createBase",
    "createBoard",
    "createWorkbook",
    "createPresentation",
    "createUniverSheet",
    "disposeUnit",
  ])("rejects prohibited lifecycle method %s and disposes", async (method) => {
    await expect(materialize(`univerAPI.${method}({ id: "typst-doc" });`)).rejects.toMatchObject({
      code: "workspace-typst-runtime-contract",
      message: `Typst materialization cannot call ${method}.`,
    });
    expect(fake.created).toHaveLength(0);
    expect(fake.disposes[0]).toHaveBeenCalledOnce();
  });

  it.each([
    ["zero", "return Promise.resolve();", [], 0],
    [
      "multiple same",
      `${createDocumentProgram("typst-doc")}\n${createDocumentProgram("typst-doc")}`,
      ["typst-doc", "typst-doc"],
      1,
    ],
    [
      "multiple different",
      `${createDocumentProgram("typst-doc")}\n${createDocumentProgram("other")}`,
      ["typst-doc", "other"],
      1,
    ],
    ["wrong", createDocumentProgram("other"), ["other"], 0],
    ["missing id", "univerAPI.createDocument({});", [], 0],
    ["empty id", 'univerAPI.createDocument({ id: "" });', [], 0],
    ["blank id", 'univerAPI.createDocument({ id: "  " });', [], 0],
    [
      "target then missing id",
      `${createDocumentProgram("typst-doc")}\nuniverAPI.createDocument({});`,
      ["typst-doc"],
      1,
    ],
    [
      "target then blank id",
      `${createDocumentProgram("typst-doc")}\nuniverAPI.createDocument({ id: "  " });`,
      ["typst-doc"],
      1,
    ],
    ["missing argument", "univerAPI.createDocument();", [], 0],
    ["null argument", "univerAPI.createDocument(null);", [], 0],
    ["primitive argument", 'univerAPI.createDocument("typst-doc");', [], 0],
  ] as const)(
    "rejects %s created identity before an invalid Facade call and disposes",
    async (_, javascript, createdUnitIds, delegatedCalls) => {
      const failure = await materialize(javascript).catch((error: unknown) => error);
      expect(failure).toMatchObject({
        code: "workspace-typst-runtime-contract",
        detail: { createdUnitIds },
      });
      expect(
        (fake.facade as { createDocument: ReturnType<typeof vi.fn> }).createDocument,
      ).toHaveBeenCalledTimes(delegatedCalls);
      expect(
        (fake.facade as { getDocument: ReturnType<typeof vi.fn> }).getDocument,
      ).not.toHaveBeenCalled();
      expect(fake.disposes[0]).toHaveBeenCalledOnce();
    },
  );

  it("rejects a missing target Doc and disposes", async () => {
    fake.getDocument = false;
    await expect(materialize(createDocumentProgram("typst-doc"))).rejects.toMatchObject({
      code: "workspace-typst-runtime-contract",
    });
    expect(fake.disposes[0]).toHaveBeenCalledOnce();
  });

  it.each([null, [], 1, "data", {}, { id: "other" }])(
    "rejects invalid saved UnitData %# and disposes",
    async (saved) => {
      fake.saved = saved;
      await expect(materialize(createDocumentProgram("typst-doc"))).rejects.toMatchObject({
        code: "workspace-typst-runtime-contract",
      });
      expect(fake.disposes[0]).toHaveBeenCalledOnce();
    },
  );

  it("restores complete random descriptors and fills only the supplied typed-array view", async () => {
    const mathBefore = Object.getOwnPropertyDescriptor(Math, "random");
    const cryptoBefore = Object.getOwnPropertyDescriptor(globalThis.crypto, "getRandomValues");
    fake.saved = { id: "typst-doc" };
    const javascript = `
      const backing = new Uint8Array([7, 7, 7, 7, 7, 7]);
      const view = new Uint8Array(backing.buffer, 2, 3);
      const returned = crypto.getRandomValues(view);
      univerAPI.createDocument({
        id: "typst-doc",
        bytes: Array.from(backing),
        random: Math.random(),
        sameView: returned === view,
      });
    `;

    await materialize(javascript);
    const first = fake.created[0];
    await materialize(javascript);
    expect(fake.created[1]).toEqual(first);
    expect(first?.["sameView"]).toBe(true);
    expect((first?.["bytes"] as number[]).slice(0, 2)).toEqual([7, 7]);
    expect((first?.["bytes"] as number[]).slice(5)).toEqual([7]);
    expect(Object.getOwnPropertyDescriptor(Math, "random")).toEqual(mathBefore);
    expect(Object.getOwnPropertyDescriptor(globalThis.crypto, "getRandomValues")).toEqual(
      cryptoBefore,
    );
    expect(fake.disposes.every((dispose) => dispose.mock.calls.length === 1)).toBe(true);
  });

  it("restores absent own random descriptors after program failure", async () => {
    const mathBefore = Object.getOwnPropertyDescriptor(Math, "random")!;
    const cryptoBefore = Object.getOwnPropertyDescriptor(globalThis.crypto, "getRandomValues");
    delete (Math as { random?: unknown }).random;
    if (cryptoBefore !== undefined)
      delete (globalThis.crypto as { getRandomValues?: unknown }).getRandomValues;
    try {
      await expect(materialize('throw new Error("program failed");')).rejects.toThrow(
        "program failed",
      );
      expect(Object.hasOwn(Math, "random")).toBe(false);
      expect(Object.hasOwn(globalThis.crypto, "getRandomValues")).toBe(false);
      expect(fake.disposes[0]).toHaveBeenCalledOnce();
    } finally {
      Object.defineProperty(Math, "random", mathBefore);
      if (cryptoBefore !== undefined)
        Object.defineProperty(globalThis.crypto, "getRandomValues", cryptoBefore);
    }
  });

  it("disposes before surfacing save failure and does not dispose when factory fails", async () => {
    const saveFailure = new Error("save failed");
    fake.saveError = saveFailure;
    await expect(materialize(createDocumentProgram("typst-doc"))).rejects.toBe(saveFailure);
    expect(fake.disposes[0]).toHaveBeenCalledOnce();

    fake.disposes.length = 0;
    const factoryFailure = new Error("factory failed");
    fake.factoryError = factoryFailure;
    await expect(materialize(createDocumentProgram("typst-doc"))).rejects.toBe(factoryFailure);
    expect(fake.disposes).toHaveLength(0);
  });
});

function materialize(javascript: string) {
  return new HeadlessWorkspaceTypstMaterializer().materialize({
    javascript,
    targetUnitId: "typst-doc",
  });
}

function createDocumentProgram(id: string): string {
  return `univerAPI.createDocument({ id: ${JSON.stringify(id)} });`;
}
