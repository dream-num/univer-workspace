import type { ModeDefinition } from "../registry";
import { repositoryMessages } from "./messages";

export const repositoryMode = {
  label: "repositoryTheme",
  messages: repositoryMessages,
} as const satisfies ModeDefinition;
