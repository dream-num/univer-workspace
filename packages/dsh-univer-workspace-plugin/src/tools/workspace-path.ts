import type { ToolRunContext } from "@deepseek-ai/dsh-tools";
import { authorizedSessionPath, SessionPathError, type AuthorizedSessionPath } from "@univerjs/univer-workspace-agent-runtime/workspace-session-path";
import { UniverError } from "./errors.ts";
export type { AuthorizedSessionPath };
export function toolWorkspaceCwd(exec: ToolRunContext): string {
  const cwd = exec.agent?.session.header.cwd;
  if (!cwd?.trim()) throw new UniverError("Univer tools require a calling agent with a workspace.", "SESSION_SCOPE_UNAVAILABLE");
  return cwd;
}
async function resolve(exec: ToolRunContext, value: string, existing: boolean): Promise<AuthorizedSessionPath> {
  try { return await authorizedSessionPath(exec.agent?.session.header.cwd, value, existing); }
  catch (error) {
    if (error instanceof SessionPathError) throw new UniverError(error.message, error.code, { cause: error });
    throw error;
  }
}
export const existingSessionPath = (exec: ToolRunContext, value: string) => resolve(exec, value, true);
export const newSessionPath = (exec: ToolRunContext, value: string) => resolve(exec, value, false);
