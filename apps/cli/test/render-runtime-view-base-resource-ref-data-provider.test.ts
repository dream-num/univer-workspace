import type { BaseDataModel, IBaseSnapshot, IUniverInstanceService } from "@univerjs/core";
import type { IReferencedUnitManagerService, ResourceRefInput } from "@univerjs-pro/embed";
import {
  BASE_RECORD_ID_FIELD_ID,
  BaseFieldType,
  createBaseRecordIdField,
  UniverInstanceType,
} from "@univerjs/core";
import { ReferencedUnitDataType } from "@univerjs-pro/embed";
import { describe, expect, it, vi } from "vitest";
import { createViewBaseResourceRefDataProviderRegistration } from "../render-runtime/src/preset/view-base-resource-ref-data-provider.js";

describe("View Base ResourceRef data provider", () => {
  it("materializes one referenced Base and returns the requested table", async () => {
    const snapshot = createBaseSnapshot();
    const ensure = vi.fn<Pick<IReferencedUnitManagerService, "ensure">["ensure"]>(async () => ({
      ref: "univer://self#unit=base-1&type=base",
      unitId: "base-1",
      unitType: UniverInstanceType.UNIVER_BASE,
    }));
    const getUnit = vi.fn(
      () =>
        ({
          getSnapshot: () => snapshot,
        }) as BaseDataModel,
    );
    const registration = createViewBaseResourceRefDataProviderRegistration(() => ({
      referencedUnitManager: { ensure },
      univerInstanceService: {
        getUnit: getUnit as unknown as Pick<IUniverInstanceService, "getUnit">["getUnit"],
      },
    }));

    const ref: ResourceRefInput = {
      file: { kind: "self" },
      unit: { selector: "base-1", type: "base" },
      part: { kind: "table", tableName: "budget" },
    };
    const result = await registration.provider.readData({
      ref,
      unitType: UniverInstanceType.UNIVER_BASE,
      dataType: ReferencedUnitDataType.TABLE,
      selector: ref.part!,
    });

    expect(ensure).toHaveBeenCalledWith(
      {
        file: { kind: "self" },
        unit: { selector: "base-1", type: "base" },
      },
      { unitType: UniverInstanceType.UNIVER_BASE },
    );
    expect(getUnit).toHaveBeenCalledWith("base-1", UniverInstanceType.UNIVER_BASE);
    expect(result).toEqual({
      type: ReferencedUnitDataType.TABLE,
      tableName: "budget",
      sheetName: "Budget",
      sheetId: "budget",
      range: {
        startRow: 0,
        endRow: 1,
        startColumn: 0,
        endColumn: 1,
      },
      columns: ["record-id", "Amount"],
      showHeader: false,
      values: [
        ["record-1", 400],
        ["record-2", 500],
      ],
    });
  });

  it("resolves a Base table by its canonical formula name", async () => {
    const snapshot = createBaseSnapshot();
    snapshot.tables.budget!.name = "07 | Inventory and alerts";
    const ensure = vi.fn<Pick<IReferencedUnitManagerService, "ensure">["ensure"]>(async () => ({
      ref: "univer://self#unit=base-1&type=base",
      unitId: "base-1",
      unitType: UniverInstanceType.UNIVER_BASE,
    }));
    const registration = createViewBaseResourceRefDataProviderRegistration(() => ({
      referencedUnitManager: { ensure },
      univerInstanceService: {
        getUnit: (() => ({ getSnapshot: () => snapshot }) as BaseDataModel) as unknown as Pick<
          IUniverInstanceService,
          "getUnit"
        >["getUnit"],
      },
    }));
    const ref: ResourceRefInput = {
      file: { kind: "self" },
      unit: { selector: "base-1", type: "base" },
      part: { kind: "table", tableName: "_07_Inventory_and_alerts" },
    };

    const result = await registration.provider.readData({
      ref,
      unitType: UniverInstanceType.UNIVER_BASE,
      dataType: ReferencedUnitDataType.TABLE,
      selector: ref.part!,
    });

    expect(result).toMatchObject({
      type: ReferencedUnitDataType.TABLE,
      tableName: "_07_Inventory_and_alerts",
      sheetId: "budget",
      columns: ["record-id", "Amount"],
      values: [
        ["record-1", 400],
        ["record-2", 500],
      ],
    });
  });
});

function createBaseSnapshot(): IBaseSnapshot {
  return {
    id: "base-1",
    name: "Finance Base",
    tableOrder: ["budget"],
    tables: {
      budget: {
        id: "budget",
        name: "Budget",
        primaryFieldId: "amount",
        fieldOrder: [BASE_RECORD_ID_FIELD_ID, "amount"],
        fields: {
          [BASE_RECORD_ID_FIELD_ID]: createBaseRecordIdField(),
          amount: {
            id: "amount",
            name: "Amount",
            type: BaseFieldType.Number,
          },
        },
        recordOrder: ["record-1", "record-2"],
        records: {
          "record-1": { id: "record-1", values: { amount: 400 } },
          "record-2": { id: "record-2", values: { amount: 500 } },
        },
        viewOrder: [],
        views: {},
      },
    },
  } as unknown as IBaseSnapshot;
}
