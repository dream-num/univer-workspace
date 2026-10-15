import { RepositoryHomePage } from "./pages/home";
import { RepositoryShell } from "./repository-shell";
import type { ModeDefinition } from "../registry";
import { repositoryMessages } from "./messages";

export const repositoryMode = {
  pages: { home: RepositoryHomePage },
  label: "repositoryTheme",
  Shell: RepositoryShell,
  messages: repositoryMessages,
} as const satisfies ModeDefinition;
