import { describe, expect, it, vi } from "vitest";

const headless = vi.hoisted(() => {
  const state = { saved: {} as Readonly<Record<string, unknown>> };
  const document = { save: vi.fn(() => state.saved) };
  const facade = {
    createDocument: vi.fn(() => document),
    getDocument: vi.fn(() => document),
  };
  const univer = { dispose: vi.fn() };
  return {
    facade,
    factory: vi.fn(() => async () => univer),
    state,
    univer,
  };
});

vi.mock("@univer-cli/headless-univer", () => ({
  createStandardHeadlessUniverFacade: vi.fn(() => headless.facade),
  createStandardHeadlessUniverFactory: headless.factory,
}));

import { HeadlessWorkspaceTypstMaterializer } from "../src/typst-materialize.js";
import { WorkspaceCompileTypstFeature } from "../src/typst.js";

describe("Headless Typst UnitData boundary", () => {
  it("rejects unsafe nested saved data without invoking accessors or inherited toJSON", async () => {
    let getterCalls = 0;
    let prototypeGetterCalls = 0;
    let toJsonCalls = 0;
    const accessor = Object.defineProperty({}, "secret", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return "private";
      },
    });
    const symbolKey = { visible: true } as Record<PropertyKey, unknown>;
    symbolKey[Symbol("private")] = true;
    const onlyConstructor = Object.create(null) as Record<PropertyKey, unknown>;
    Object.defineProperty(onlyConstructor, "constructor", { value: Object });
    const inheritedToJsonPrototype = copyObjectPrototype();
    Object.defineProperty(inheritedToJsonPrototype, "toJSON", {
        value() {
          toJsonCalls += 1;
          return "private";
        },
    });
    const extraPrototype = copyObjectPrototype();
    Object.defineProperty(extraPrototype, "extra", { value: true });
    const symbolPrototype = copyObjectPrototype();
    Object.defineProperty(symbolPrototype, Symbol("extra"), { value: true });
    const accessorPrototype = copyObjectPrototype();
    Object.defineProperty(accessorPrototype, "toString", {
      configurable: true,
      get() {
        prototypeGetterCalls += 1;
        return Object.prototype.toString;
      },
    });
    const flagsPrototype = copyObjectPrototype();
    Object.defineProperty(flagsPrototype, "toString", {
      ...Object.getOwnPropertyDescriptor(Object.prototype, "toString")!,
      enumerable: true,
    });
    const withPrototype = (prototype: object) => {
      const value = Object.create(prototype) as Record<string, unknown>;
      value["visible"] = true;
      return value;
    };
    const create = vi.fn();
    const feature = new WorkspaceCompileTypstFeature({
      compile: async () => ({
        diagnostics: [],
        javascript: "return Promise.resolve(univerAPI.createDocument({ id: 'typst-doc' }));",
        previews: [],
        targetUnitId: "typst-doc",
        title: "Compiled paper",
      }),
      materializer: new HeadlessWorkspaceTypstMaterializer(),
      units: { create },
    });

    for (const unsafe of [
      accessor,
      symbolKey,
      onlyConstructor,
      inheritedToJsonPrototype,
      extraPrototype,
      symbolPrototype,
      accessorPrototype,
      flagsPrototype,
    ].map((value, index) => index < 2 ? value : withPrototype(value))) {
      headless.state.saved = { id: "typst-doc", unsafe };
      await expect(feature.execute({
        apply: { spaceId: "space-1", worktreeId: "wt-1" },
        bundlePath: "paper",
        maxUnitDataBytes: 100,
      })).rejects.toMatchObject({
        code: "workspace-typst-limit-exceeded",
        detail: { kind: "unit-data-json" },
      });
    }

    expect(getterCalls).toBe(0);
    expect(prototypeGetterCalls).toBe(0);
    expect(toJsonCalls).toBe(0);
    expect(create).not.toHaveBeenCalled();
    expect(headless.factory).toHaveBeenCalledTimes(8);
    expect(headless.univer.dispose).toHaveBeenCalledTimes(8);
  });
});

function copyObjectPrototype(): object {
  return Object.defineProperties(
    Object.create(null) as object,
    Object.getOwnPropertyDescriptors(Object.prototype),
  );
}
