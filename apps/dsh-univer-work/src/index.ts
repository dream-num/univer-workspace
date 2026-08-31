import type { Context } from "@deepseek-ai/cordis";
import Schema from "@deepseek-ai/schemastery";
import { mountWorkspaceAuthentication } from "./authentication.js";

export const name = "dsh-univer-work";
export const inject = ["credentials", "tools", "skills", "fs"];

export interface Config {
  readonly origin: string;
}

export const Config: Schema<Config> = Schema.object({
  origin: Schema.string(),
});

export function apply(ctx: Context, config: Config = { origin: "" }): void {
  mountWorkspaceAuthentication(ctx, { workspaceOrigin: config.origin });
}
