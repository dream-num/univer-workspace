import type { Context } from "@deepseek-ai/cordis";
import { mountWorkspaceAuthentication } from "./authentication.js";

export const name = "dsh-univer-work";
export const inject = ["credentials", "tools", "skills", "fs"];

export function apply(ctx: Context): void {
  mountWorkspaceAuthentication(ctx);
}
