/** Authenticated Workspace transport shared by the existing Agent tools. */
export interface WorkspaceHttpClient {
  readonly origin: string;
  readonly sessionToken: string;
  request(path: string, init?: RequestInit): Promise<Response>;
}
