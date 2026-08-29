import { describe, expect, it } from "vitest";
import { setFinalMutationSize } from "../../server/src/integrations/univer/changeset-observation.js";

describe("changeset observation metadata", () => {
  it("measures the compact mutations JSON in UTF-8 bytes", () => {
    const changeset: {
      readonly mutations: readonly unknown[];
      mutationSize?: number;
    } = {
      mutations: [{ id: "mutation", data: "你好🌍" }],
      mutationSize: 1,
    };

    setFinalMutationSize(changeset);

    expect(changeset.mutationSize).toBe(
      Buffer.byteLength(JSON.stringify(changeset.mutations), "utf8")
    );
  });

  it("counts an empty mutations array as two bytes", () => {
    const changeset: { readonly mutations: readonly unknown[]; mutationSize?: number } = {
      mutations: [],
    };
    setFinalMutationSize(changeset);
    expect(changeset.mutationSize).toBe(2);
  });
});
