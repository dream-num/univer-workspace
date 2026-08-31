import { beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  created: [] as Readonly<Record<string, unknown>>[],
  disposeError: undefined as unknown,
  disposes: [] as ReturnType<typeof vi.fn>[],
  factoryError: undefined as unknown,
  factorySettled: undefined as Promise<void> | undefined,
  factoryStarted: undefined as (() => void) | undefined,
  factoryOptions: [] as unknown[],
  facade: undefined as unknown,
  getDocument: true,
  initInputs: [] as unknown[],
  saveCalls: 0,
  saved: { id: "typst-doc", name: "Runtime paper", rev: 99 } as unknown,
  saveError: undefined as unknown,
}));

vi.mock("@univer-cli/headless-univer", () => ({
  createStandardHeadlessUniverFacade: () => fake.facade,
  createStandardHeadlessUniverFactory: (options: unknown) => {
    fake.factoryOptions.push(options);
    return async (input: unknown) => {
      fake.initInputs.push(input);
      fake.factoryStarted?.();
      await fake.factorySettled;
      if (fake.factoryError !== undefined) throw fake.factoryError;
      const dispose = vi.fn(() => {
        if (fake.disposeError !== undefined) throw fake.disposeError;
      });
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
  fake.disposeError = undefined;
  fake.factoryError = undefined;
  fake.factorySettled = undefined;
  fake.factoryStarted = undefined;
  fake.factoryOptions.length = 0;
  fake.getDocument = true;
  fake.initInputs.length = 0;
  fake.saveCalls = 0;
  fake.saved = { id: "typst-doc", name: "Runtime paper", rev: 99 };
  fake.saveError = undefined;
  const document = {
    save: vi.fn(() => {
      fake.saveCalls += 1;
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

  it("isolates concurrent deterministic random sequences from Host globals", async () => {
    const mathBefore = Object.getOwnPropertyDescriptor(Math, "random");
    const cryptoBefore = Object.getOwnPropertyDescriptor(globalThis.crypto, "getRandomValues");
    const bothStarted = deferred<void>();
    const release = deferred<void>();
    let started = 0;
    Object.assign(fake.facade as object, {
      waitForPeer: async () => {
        started += 1;
        if (started === 2) bothStarted.resolve();
        await release.promise;
      },
    });
    fake.saved = { id: "typst-doc" };
    const javascript = `
      const backing = new Uint8Array([7, 7, 7, 7, 7, 7]);
      const view = new Uint8Array(backing.buffer, 2, 3);
      const firstRandom = Math.random();
      const returned = crypto.getRandomValues(view);
      return univerAPI.waitForPeer().then(() => {
        univerAPI.createDocument({
          id: "typst-doc",
          bytes: Array.from(backing),
          random: [firstRandom, Math.random()],
          sameView: returned === view,
        });
      });
    `;

    const first = materialize(javascript);
    const second = materialize(javascript);
    await bothStarted.promise;
    expect(Object.getOwnPropertyDescriptor(Math, "random")).toEqual(mathBefore);
    expect(Object.getOwnPropertyDescriptor(globalThis.crypto, "getRandomValues")).toEqual(
      cryptoBefore,
    );
    release.resolve();
    await Promise.all([first, second]);
    expect(fake.created[1]).toEqual(fake.created[0]);
    const created = fake.created[0];
    expect(created?.["sameView"]).toBe(true);
    expect((created?.["bytes"] as number[]).slice(0, 2)).toEqual([7, 7]);
    expect((created?.["bytes"] as number[]).slice(5)).toEqual([7]);
    expect(Object.getOwnPropertyDescriptor(Math, "random")).toEqual(mathBefore);
    expect(Object.getOwnPropertyDescriptor(globalThis.crypto, "getRandomValues")).toEqual(
      cryptoBefore,
    );
    expect(fake.disposes.every((dispose) => dispose.mock.calls.length === 1)).toBe(true);
  });

  it("does not expose or modify Host globals when a program fails", async () => {
    const key = "__workspaceTypstHostSentinel";
    const mathBefore = Object.getOwnPropertyDescriptor(Math, "random");
    const cryptoBefore = Object.getOwnPropertyDescriptor(globalThis.crypto, "getRandomValues");
    Object.defineProperty(globalThis, key, { configurable: true, value: "host-only" });
    try {
      await expect(materialize(`
        if (globalThis.${key} !== undefined) throw new Error("Host global leaked");
        if (globalThis.__workspaceTypstNextUint32 !== undefined) {
          throw new Error("random bridge leaked");
        }
        throw new Error("program failed");
      `)).rejects.toThrow("program failed");
      expect(Object.getOwnPropertyDescriptor(Math, "random")).toEqual(mathBefore);
      expect(Object.getOwnPropertyDescriptor(globalThis.crypto, "getRandomValues")).toEqual(
        cryptoBefore,
      );
      expect(fake.disposes[0]).toHaveBeenCalledOnce();
    } finally {
      Reflect.deleteProperty(globalThis, key);
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

  it("passes an optional license without exposing it in success or dependency failure", async () => {
    const license = "typst-license-sentinel";
    const result = await materialize(createDocumentProgram("typst-doc"), { license });
    expect(fake.factoryOptions).toEqual([{ license }]);
    expect(JSON.stringify(result)).not.toContain(license);

    fake.factoryError = new Error(license);
    const failure = await materialize(createDocumentProgram("typst-doc"), { license }).catch(
      (error: unknown) => error,
    );
    expect(failure).toMatchObject({
      code: "workspace-typst-runtime-contract",
      message: "Typst materialization failed inside the disposable Doc runtime.",
    });
    expect(JSON.stringify(failure)).not.toContain(license);

    fake.factoryError = undefined;
    fake.disposeError = new Error(license);
    const disposeFailure = await materialize(createDocumentProgram("typst-doc"), { license }).catch(
      (error: unknown) => error,
    );
    expect(disposeFailure).toMatchObject({
      code: "workspace-typst-runtime-contract",
      message: "Typst materialization failed inside the disposable Doc runtime.",
    });
    expect(JSON.stringify(disposeFailure)).not.toContain(license);
  });

  it("does no runtime work for a pre-aborted signal", async () => {
    await expect(new HeadlessWorkspaceTypstMaterializer().materialize({
      javascript: createDocumentProgram("typst-doc"),
      signal: AbortSignal.abort(),
      targetUnitId: "typst-doc",
    })).rejects.toMatchObject({ name: "AbortError" });
    expect(fake.factoryOptions).toEqual([]);
    expect(fake.initInputs).toEqual([]);
    expect(fake.disposes).toEqual([]);
  });

  it("awaits a running program, then observes cancellation before save and disposes", async () => {
    const started = deferred<void>();
    const settled = deferred<void>();
    Object.assign(fake.facade as object, {
      programBarrier: {
        settled: settled.promise,
        started: () => started.resolve(),
      },
    });
    const controller = new AbortController();
    let completed = false;
    const operation = new HeadlessWorkspaceTypstMaterializer().materialize({
      javascript: `univerAPI.programBarrier.started(); return univerAPI.programBarrier.settled.then(() => univerAPI.createDocument({ id: "typst-doc" }));`,
      signal: controller.signal,
      targetUnitId: "typst-doc",
    }).finally(() => {
      completed = true;
    });
    await started.promise;
    controller.abort();
    await Promise.resolve();
    expect(completed).toBe(false);
    settled.resolve();
    await expect(operation).rejects.toMatchObject({ name: "AbortError" });
    expect(fake.created).toEqual([{ id: "typst-doc" }]);
    expect(fake.saveCalls).toBe(0);
    expect(fake.disposes[0]).toHaveBeenCalledOnce();
  });

  it.each(["caller", "owner"] as const)(
    "preserves the exact licensed %s cancellation reason after a running program settles",
    async (source) => {
      const started = deferred<void>();
      const settled = deferred<void>();
      Object.assign(fake.facade as object, {
        licensedProgramBarrier: {
          settled: settled.promise,
          started: () => started.resolve(),
        },
      });
      const controller = new AbortController();
      const reason = new DOMException(`${source} stopped`, "AbortError");
      const operation = new HeadlessWorkspaceTypstMaterializer({ license: "licensed" }).materialize({
        javascript: `univerAPI.licensedProgramBarrier.started(); return univerAPI.licensedProgramBarrier.settled;`,
        signal: controller.signal,
        targetUnitId: "typst-doc",
      });
      await started.promise;
      controller.abort(reason);
      settled.resolve();
      await expect(operation).rejects.toBe(reason);
      expect(fake.saveCalls).toBe(0);
      expect(fake.disposes[0]).toHaveBeenCalledOnce();
    },
  );

  it("preserves a concurrent abort when a licensed factory later rejects", async () => {
    const started = deferred<void>();
    const settled = deferred<void>();
    const license = "factory-license-sentinel";
    fake.factoryStarted = () => started.resolve();
    fake.factorySettled = settled.promise;
    fake.factoryError = new Error(license);
    const controller = new AbortController();
    const reason = new DOMException("caller stopped", "AbortError");

    const operation = new HeadlessWorkspaceTypstMaterializer({ license }).materialize({
      javascript: createDocumentProgram("typst-doc"),
      signal: controller.signal,
      targetUnitId: "typst-doc",
    });
    await started.promise;
    controller.abort(reason);
    settled.resolve();
    await expect(operation).rejects.toBe(reason);
    expect(fake.disposes).toHaveLength(0);
  });

  it.each([undefined, null] as const)(
    "preserves an omitted-license program rejection reason %# over cleanup",
    async (reason) => {
      fake.disposeError = new Error("cleanup must not replace the program reason");
      const outcome = await materialize(`throw ${reason === null ? "null" : "undefined"};`).then(
        () => ({ settled: "resolved" as const }),
        (rejected: unknown) => ({ reason: rejected, settled: "rejected" as const }),
      );
      expect(outcome.settled).toBe("rejected");
      expect("reason" in outcome ? outcome.reason : "missing").toBe(reason);
      expect(fake.disposes[0]).toHaveBeenCalledOnce();
    },
  );
});

function materialize(
  javascript: string,
  options: ConstructorParameters<typeof HeadlessWorkspaceTypstMaterializer>[0] = {},
) {
  return new HeadlessWorkspaceTypstMaterializer(options).materialize({
    javascript,
    targetUnitId: "typst-doc",
  });
}

function deferred<Value>() {
  let resolve!: (value: Value | PromiseLike<Value>) => void;
  const promise = new Promise<Value>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function createDocumentProgram(id: string): string {
  return `univerAPI.createDocument({ id: ${JSON.stringify(id)} });`;
}
