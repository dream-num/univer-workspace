import { RepositoryShell } from "./repository-shell";
import type { ModeDefinition } from "../registry";
import { repositoryMessages } from "./messages";

export const repositoryMode = {
  label: "repositoryTheme",
  Shell: RepositoryShell,
  messages: repositoryMessages,
} as const satisfies ModeDefinition;
