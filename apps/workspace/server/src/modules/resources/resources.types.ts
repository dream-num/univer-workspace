import type { UnitType } from "../access/index.js";
import type { NodeSummary, ResourceSummary } from "../nodes/index.js";

export type OperationState = "pending" | "completed" | "failed";

export interface OperationView {
  readonly id: string;
  readonly kind: "createResource" | "createBlobResource";
  readonly state: OperationState;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly result: Readonly<Record<string, unknown>> | null;
  readonly error: {
    readonly code: string;
    readonly message: string;
  } | null;
}

export interface CreateResourceIntent {
  readonly kind: "univer";
  readonly spaceId: string;
  readonly parentNodeId: string | null;
  readonly name: string;
  readonly unitType: UnitType;
  readonly initialData?: Readonly<Record<string, unknown>>;
}

export interface CreateResourcePayload extends CreateResourceIntent {
  readonly nodeId: string;
  readonly resourceId: string;
  readonly unitId: string;
}

export interface ResourceCreateResponse {
  readonly operation: OperationView;
  readonly node: NodeSummary;
}

export interface ResourceResponse {
  readonly resource: ResourceSummary;
  readonly node: NodeSummary;
}

export type ResourceOpenView =
  | { readonly resource: {
    readonly id: string;
    readonly kind: "univer";
    readonly nodeId: string;
    readonly spaceId: string;
    readonly name: string;
    readonly unitId: string;
    readonly unitType: UnitType;
    readonly accessRole: "owner" | "admin" | "editor" | "viewer";
    readonly editorMode: "edit" | "readOnly";
  } }
  | { readonly resource: {
    readonly id: string;
    readonly kind: "blob";
    readonly nodeId: string;
    readonly spaceId: string;
    readonly name: string;
    readonly accessRole: import("../access/index.js").AccessRole;
    readonly originalFilename: string;
    readonly mediaType: string;
    readonly byteSize: number;
    readonly sha256: string;
    readonly contentUrl: string;
    readonly downloadUrl: string;
  } };
