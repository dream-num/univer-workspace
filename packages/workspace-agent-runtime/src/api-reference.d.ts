export interface WorkspaceApiQuery {
  action: 'find' | 'show';
  queries: string[];
  unit?: 'sheet' | 'doc' | 'slide' | 'base' | 'board';
  limit?: number;
}
export declare class ApiReferenceInputError extends Error {}
export declare function queryWorkspaceApi(args: WorkspaceApiQuery): Promise<{ ok: true; operation: 'api'; result: unknown }>;
