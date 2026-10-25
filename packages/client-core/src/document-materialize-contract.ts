/** JSON-only Node client port; runtime implementation is selected by the public package export. */
export interface WorkspaceDocumentProgramInput {
  readonly javascript: string;
  readonly targetUnitId: string;
}
export interface WorkspaceDocumentProgramOptions {
  readonly format: "Markdown" | "Typst";
  readonly license: string;
}
export interface WorkspaceMaterializedDocument {
  readonly initialData: Readonly<Record<string, unknown>>;
  readonly name?: string;
  readonly value?: unknown;
}
export declare function materializeWorkspaceDocument(
  input: WorkspaceDocumentProgramInput,
  options: WorkspaceDocumentProgramOptions,
): Promise<WorkspaceMaterializedDocument>;
