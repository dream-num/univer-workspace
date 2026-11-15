/** Product creation records consumed only when upgrading a legacy collaboration database. */
export interface ProductUnitCreation {
  readonly unitId: string;
  readonly creatorId: string;
  readonly createdAt: number;
}

export interface ProductWorktreeUnitCreation extends ProductUnitCreation {
  readonly worktreeId: string;
}

export interface UnitCreationFactsReader {
  read(): Promise<{
    readonly units: readonly ProductUnitCreation[];
    readonly worktreeUnits: readonly ProductWorktreeUnitCreation[];
  }>;
}
