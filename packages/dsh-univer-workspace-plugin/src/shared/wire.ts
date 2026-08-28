/**
 * Shared host/client wire types for the capability plugin.
 *
 * These are plain JSON shapes crossing the browser↔host boundary and the
 * tool output schemas. They never import node, React, cordis, or Univer
 * runtime modules.
 * @module dsh-univer-workspace-plugin/shared/wire
 */

/** Univer Workspace Space as seen by an agent or the browser. */
export interface WorkspaceSpace {
  /** Univer Workspace Space id (the "spaceId" a user selects). */
  readonly spaceId: string;
  /** `personal` or `team`. */
  readonly type: "personal" | "team";
  readonly name: string;
  readonly accessRole: "owner" | "admin" | "editor" | "viewer";
  /** The dsh workspace id backing this Space (the mechanical directory carrier). */
  readonly dshWorkspaceId: string;
}

/** One document (Node + optional Univer Resource) inside a Space. */
export interface WorkspaceDocument {
  readonly nodeId: string;
  readonly name: string;
  /** Parent organization Node; `null` means the Space root. */
  readonly parentNodeId: string | null;
  /** Whether this Node has children that can be listed through the API. */
  readonly hasChildren: boolean;
  /** Product last-update timestamp, when the server supplied one. */
  readonly updatedAt: string | null;
  /** `univer` resource id, or `null` for a pure organization Node. */
  readonly resourceId: string | null;
  /** Product resource kind; `null` denotes an organization-only Node. */
  readonly resourceKind: "univer" | "blob" | null;
  /** Blob metadata when the resource is a Blob. */
  readonly mediaType?: string;
  readonly byteSize?: number;
  readonly availability?: "ready" | "quarantined";
  /** Univer Unit id, or `null` for a pure organization Node. */
  readonly unitId: string | null;
  /** Univer Unit type, or `null` for a pure organization Node. */
  readonly unitType: "sheet" | "doc" | "slide" | "board" | "base" | null;
  readonly accessRole: "owner" | "admin" | "editor" | "viewer";
  /** Node and resource capabilities returned by the product API. */
  readonly nodeCapabilities?: Readonly<Record<string, boolean>>;
  readonly resourceCapabilities?: Readonly<Record<string, boolean>>;
}

/** The opened document descriptor returned by the `univer_open` tool. */
export interface WorkspaceDocumentOpen {
  readonly nodeId: string;
  readonly resourceId: string;
  readonly unitId: string;
  readonly unitType: "sheet" | "doc" | "slide" | "board" | "base";
  readonly name: string;
  readonly spaceId: string;
  readonly accessRole: "owner" | "admin" | "editor" | "viewer";
  readonly editorMode: "edit" | "readOnly";
}

/** List of Spaces answer. */
export interface SpacesResult {
  readonly spaces: readonly WorkspaceSpace[];
}

/** List of documents answer. */
export interface DocumentsResult {
  readonly spaceId: string;
  readonly documents: readonly WorkspaceDocument[];
}

/** Server-side discovery filters accepted by the document listing tools. */
export interface DocumentListOptions {
  /** Return children below this Node; omitted means the Space root. */
  readonly parentNodeId?: string | null;
  /** Include descendants of `parentNodeId` (defaults to true). */
  readonly recursive?: boolean;
  /** Case-insensitive name substring. */
  readonly query?: string;
  /** `folder` selects organization Nodes; `all` keeps every resource kind. */
  readonly resourceKind?: "univer" | "blob" | "folder" | "all";
  readonly unitType?: "sheet" | "doc" | "slide" | "board" | "base";
}
