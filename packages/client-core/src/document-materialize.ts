import { HeadlessWorkspaceDocumentMaterializer } from "./typst-materialize.js";
import type {
  WorkspaceDocumentProgramInput,
  WorkspaceDocumentProgramOptions,
  WorkspaceMaterializedDocument,
} from "./document-materialize-contract.js";

export async function materializeWorkspaceDocument(
  input: WorkspaceDocumentProgramInput,
  options: WorkspaceDocumentProgramOptions,
): Promise<WorkspaceMaterializedDocument> {
  return await new HeadlessWorkspaceDocumentMaterializer(
    options.format,
    options.license,
  ).materialize(input);
}
