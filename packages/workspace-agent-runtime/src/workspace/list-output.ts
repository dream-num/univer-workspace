import type { DocumentListOptions, WorkspaceDocument } from './wire.js';

export type ListArguments = {
  /** Defaults to the Space linked to the calling DSH session. */
  readonly spaceId?: string;
  readonly parentNodeId?: string;
  readonly recursive?: boolean;
  readonly query?: string;
  readonly resourceKind?: "univer" | "blob" | "folder" | "all";
  readonly unitType?: "sheet" | "doc" | "slide" | "board" | "base";
};

export function listOptions(args: ListArguments): DocumentListOptions {
  return {
    ...(args.parentNodeId === undefined ? {} : { parentNodeId: args.parentNodeId }),
    ...(args.recursive === undefined ? {} : { recursive: args.recursive }),
    ...(args.query === undefined ? {} : { query: args.query }),
    ...(args.resourceKind === undefined ? {} : { resourceKind: args.resourceKind }),
    ...(args.unitType === undefined ? {} : { unitType: args.unitType }),
  };
}

interface ListedDocument {
  readonly nodeId: string;
  readonly name: string;
  readonly parentNodeId: string | null;
  readonly hasChildren: boolean;
  readonly updatedAt: string | null;
  readonly resourceId: string;
  readonly resourceKind: "univer" | "blob";
  readonly unitType?: "sheet" | "doc" | "slide" | "board" | "base";
  readonly mediaType?: string;
  readonly byteSize?: number;
  readonly availability?: "ready" | "quarantined";
  readonly accessRole: string;
  readonly nodeCapabilities?: Record<string, boolean>;
  readonly resourceCapabilities?: Record<string, boolean>;
}

interface ListedFolder {
  readonly nodeId: string;
  readonly name: string;
  readonly parentNodeId: string | null;
  readonly hasChildren: boolean;
  readonly updatedAt: string | null;
  readonly accessRole: string;
  readonly nodeCapabilities?: Record<string, boolean>;
}

export function listOutput(
  documents: readonly WorkspaceDocument[],
  spaceId: string,
): {
  spaceId: string;
  documents: ListedDocument[];
  folders: ListedFolder[];
} {
  const folders = documents
    .filter((document) => document.resourceKind === null)
    .map((folder) => ({
      nodeId: folder.nodeId,
      name: folder.name,
      parentNodeId: folder.parentNodeId,
      hasChildren: folder.hasChildren,
      updatedAt: folder.updatedAt,
      accessRole: folder.accessRole,
      ...(folder.nodeCapabilities === undefined
        ? {}
        : { nodeCapabilities: folder.nodeCapabilities }),
    }));
  const listed = documents
    .filter((document) => document.resourceKind !== null && document.resourceId !== null)
    .map((document) => ({
      nodeId: document.nodeId,
      name: document.name,
      parentNodeId: document.parentNodeId,
      hasChildren: document.hasChildren,
      updatedAt: document.updatedAt,
      resourceId: document.resourceId as string,
      resourceKind: document.resourceKind as "univer" | "blob",
      ...(document.unitType === null ? {} : { unitType: document.unitType }),
      ...(document.mediaType === undefined ? {} : { mediaType: document.mediaType }),
      ...(document.byteSize === undefined ? {} : { byteSize: document.byteSize }),
      ...(document.availability === undefined ? {} : { availability: document.availability }),
      accessRole: document.accessRole,
      ...(document.nodeCapabilities === undefined
        ? {}
        : { nodeCapabilities: document.nodeCapabilities }),
      ...(document.resourceCapabilities === undefined
        ? {}
        : { resourceCapabilities: document.resourceCapabilities }),
    }));
  return { spaceId, documents: listed, folders };
}

