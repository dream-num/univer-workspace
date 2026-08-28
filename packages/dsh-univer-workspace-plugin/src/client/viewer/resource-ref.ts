/**
 * ResourceRef providers used by the browser viewer.
 *
 * These are deliberately local to the viewer composition.  Embed owns the
 * ResourceRef protocol; the providers only resolve an opaque file/unit
 * descriptor through the adapter supplied by the host and expose values from
 * the already-materialized Univer model.
 */

import {
  createBaseFormulaTableNameMap,
  getOriginCellValue,
  Tools,
  UniverInstanceType,
  type BaseDataModel,
  type IUniverInstanceService,
  type Workbook,
} from "@univerjs/core";
import type { ISetFormulaCalculationResultMutation } from "@univerjs/engine-formula";
import { deserializeRangeWithSheet } from "@univerjs/engine-formula";
import {
  ensureBaseTableCellLayout,
  getBaseCellFormulaValue,
} from "@univerjs-pro/bases";
import {
  isResourceRefRangePart,
  isResourceRefTablePart,
  ReferencedUnitDataType,
  type IEmbedResourceRefDataProviderRegistration,
  type IReferencedUnitManagerService,
} from "@univerjs-pro/embed";

const VIEW_BASE_RESOURCE_REF_DATA_PROVIDER_ID =
  "univer-view-base-resource-ref-data-provider";
export const COLLABORATION_SHEET_RESOURCE_REF_DATA_PROVIDER_ID =
  "univer-collaboration-sheet-resource-ref-data-provider";

interface BaseResourceRefServices {
  readonly referencedUnitManager: Pick<IReferencedUnitManagerService, "ensure">;
  readonly univerInstanceService: Pick<IUniverInstanceService, "getUnit">;
}

interface SheetResourceRefServices extends BaseResourceRefServices {
  readonly waitForFormulaResultApplied: () => Promise<void>;
  readonly executeFormulaCalculation: () => void;
}

/** Build the table provider used by Base embeds. */
export function createBaseResourceRefDataProviderRegistration(
  getServices: () => BaseResourceRefServices,
): IEmbedResourceRefDataProviderRegistration {
  return {
    registrationId: VIEW_BASE_RESOURCE_REF_DATA_PROVIDER_ID,
    match: { fileKinds: ["self"], unitTypes: ["base"] },
    provider: {
      async readData(input) {
        if (
          input.dataType !== ReferencedUnitDataType.TABLE ||
          !isResourceRefTablePart(input.selector)
        ) {
          throw new Error("View Base ResourceRef provider only supports table reads.");
        }

        const services = getServices();
        const record = await services.referencedUnitManager.ensure(
          { file: input.ref.file, unit: input.ref.unit },
          {
            unitType: input.unitType,
            ...(input.signal ? { signal: input.signal } : {}),
          },
        );
        const base = services.univerInstanceService.getUnit<BaseDataModel>(
          record.unitId,
          UniverInstanceType.UNIVER_BASE,
        );
        if (!base) {
          throw new Error(`Referenced Base Unit is unavailable: ${record.unitId}`);
        }

        const sourceSnapshot = base.getSnapshot();
        const requestedTableName = input.selector.tableName;
        const sourceTable =
          sourceSnapshot.tables[requestedTableName] ??
          uniqueTableByFormulaName(sourceSnapshot.tables, requestedTableName) ??
          uniqueTableByName(sourceSnapshot.tables, requestedTableName);
        if (!sourceTable) {
          throw new Error(`Referenced Base table is unavailable: ${requestedTableName}`);
        }

        const table = ensureBaseTableCellLayout(Tools.deepClone(sourceTable));
        const recordIds = table.recordOrder ?? [];
        const fieldIds = table.fieldOrder;
        const values = recordIds.map((recordId) =>
          fieldIds.map((fieldId) => {
            const authoredPrimaryValue =
              fieldId === table.primaryFieldId
                ? table.records[recordId]?.values[fieldId]
                : undefined;
            if (
              typeof authoredPrimaryValue === "string" ||
              typeof authoredPrimaryValue === "number" ||
              typeof authoredPrimaryValue === "boolean"
            ) {
              return authoredPrimaryValue;
            }
            return getBaseCellFormulaValue(table, recordId, fieldId) ?? null;
          }),
        );

        return {
          type: ReferencedUnitDataType.TABLE,
          tableName: requestedTableName,
          sheetName: table.name,
          sheetId: table.id,
          range: {
            startRow: 0,
            endRow: Math.max(0, recordIds.length - 1),
            startColumn: 0,
            endColumn: Math.max(0, fieldIds.length - 1),
          },
          columns: fieldIds.map((fieldId) => table.fields[fieldId]?.name ?? fieldId),
          showHeader: false,
          values,
        };
      },
    },
  };
}

/**
 * Build the range provider used by Sheet embeds.  Formula-bearing referenced
 * sheets are intentionally read through a two-phase path: first read reports
 * a stable pending error, then the formula result event causes a local
 * recalculation and a retry.  This is the same contract as Office and avoids
 * pretending that a collaborative snapshot is already calculated.
 */
export function createSheetResourceRefDataProvider(
  getServices: () => SheetResourceRefServices,
): SheetResourceRefDataProvider {
  const referencedFormulaUnits = new Set<string>();
  const pendingFormulaUnits = new Set<string>();
  const readyFormulaUnits = new Set<string>();
  let settling: Promise<void> | undefined;
  let refreshing: Promise<void> | undefined;
  let disposed = false;

  const refreshHostFormulas = (): Promise<void> => {
    if (disposed) return Promise.resolve();
    if (refreshing) return refreshing;
    const operation = Promise.resolve()
      .then(async () => {
        if (disposed) return;
        const services = getServices();
        const applied = services.waitForFormulaResultApplied();
        services.executeFormulaCalculation();
        await applied;
      })
      .finally(() => {
        if (refreshing === operation) refreshing = undefined;
      });
    refreshing = operation;
    return operation;
  };

  const settlePendingFormulaUnits = (): Promise<void> => {
    if (settling) return settling;
    const operation = (async () => {
      await getServices().waitForFormulaResultApplied();
      if (disposed) return;
      for (const unitId of pendingFormulaUnits) readyFormulaUnits.add(unitId);
      pendingFormulaUnits.clear();
      await refreshHostFormulas();
    })().finally(() => {
      if (settling === operation) settling = undefined;
    });
    settling = operation;
    return operation;
  };

  const registration: IEmbedResourceRefDataProviderRegistration = {
    registrationId: COLLABORATION_SHEET_RESOURCE_REF_DATA_PROVIDER_ID,
    match: { fileKinds: ["self"], unitTypes: ["sheet"] },
    provider: {
      async readData(input) {
        if (
          input.dataType !== ReferencedUnitDataType.RANGE ||
          !isResourceRefRangePart(input.selector)
        ) {
          throw new Error("Collaboration Sheet ResourceRef provider only supports range reads.");
        }

        const services = getServices();
        const record = await services.referencedUnitManager.ensure(
          { file: input.ref.file, unit: input.ref.unit },
          {
            unitType: input.unitType,
            ...(input.signal ? { signal: input.signal } : {}),
          },
        );
        const workbook = services.univerInstanceService.getUnit<Workbook>(
          record.unitId,
          UniverInstanceType.UNIVER_SHEET,
        );
        if (!workbook) {
          throw new Error(`Referenced Sheet Unit is unavailable: ${record.unitId}`);
        }

        const worksheet = input.selector.sheetId
          ? workbook.getSheetBySheetId(input.selector.sheetId)
          : workbook.getSheetBySheetName(input.selector.sheetName);
        if (!worksheet) {
          throw new Error(`Referenced Sheet is unavailable: ${input.selector.sheetName}`);
        }

        const range = deserializeRangeWithSheet(input.selector.range).range;
        const cells = worksheet.getRange(range).getValues();
        const hasFormula = cells.some((row) =>
          row.some((cell) => typeof cell?.f === "string" || typeof cell?.si === "string"),
        );
        if (hasFormula) {
          referencedFormulaUnits.add(record.unitId);
          if (!readyFormulaUnits.has(record.unitId)) {
            pendingFormulaUnits.add(record.unitId);
            throw new Error(`Referenced Sheet formulas are pending: ${record.unitId}`);
          }
        }

        return {
          type: ReferencedUnitDataType.RANGE,
          values: cells.map((row) =>
            row.map((cell) => {
              const value = getOriginCellValue(cell);
              return typeof value === "string" ||
                typeof value === "number" ||
                typeof value === "boolean"
                ? value
                : null;
            }),
          ),
        };
      },
    },
  };

  return {
    registration,
    formulaResultApplied(result: ISetFormulaCalculationResultMutation) {
      if (disposed || settling || refreshing) return;
      if (pendingFormulaUnits.size > 0) return settlePendingFormulaUnits();
      if (Object.keys(result.unitData).some((unitId) => referencedFormulaUnits.has(unitId))) {
        return refreshHostFormulas();
      }
      return undefined;
    },
    dispose() {
      disposed = true;
      referencedFormulaUnits.clear();
      pendingFormulaUnits.clear();
      readyFormulaUnits.clear();
    },
  };
}

export interface SheetResourceRefDataProvider {
  readonly registration: IEmbedResourceRefDataProviderRegistration;
  formulaResultApplied(
    result: ISetFormulaCalculationResultMutation,
  ): Promise<void> | undefined;
  dispose(): void;
}

function uniqueTableByFormulaName<T extends { id: string; name: string }>(
  tables: Record<string, T>,
  requestedName: string,
): T | undefined {
  const normalizedName = requestedName.toLowerCase();
  const formulaNames = createBaseFormulaTableNameMap({ tables });
  const matches = Object.values(tables).filter(
    (table) => formulaNames.get(table.id)?.toLowerCase() === normalizedName,
  );
  return matches.length === 1 ? matches[0] : undefined;
}

function uniqueTableByName<T extends { name: string }>(
  tables: Record<string, T>,
  requestedName: string,
): T | undefined {
  const normalizedName = requestedName.toLowerCase();
  const matches = Object.values(tables).filter(
    (table) => table.name.toLowerCase() === normalizedName,
  );
  return matches.length === 1 ? matches[0] : undefined;
}
