import type { ICellData } from "@univerjs/core";
import type { createUniver } from "@univerjs/presets";
import type { IUniverCollaborationClientConfig } from "@univerjs-pro/collaboration-client";

export type BindingUniverFactory = (
  collaborationClientConfig: IUniverCollaborationClientConfig,
) => ReturnType<typeof createUniver>;

export interface BindingEngineOptions {
  readonly unitId: string;
  readonly collaborationClientConfig: IUniverCollaborationClientConfig;
  readonly createUniver?: BindingUniverFactory;
}
export type CellValue = NonNullable<ICellData["v"]>;
export interface CellReference {
  readonly sheetId: string;
  readonly row: number;
  readonly col: number;
}
export interface CellState {
  readonly value: CellValue | null;
  readonly available: boolean;
  readonly writable: boolean;
}
