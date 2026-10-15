import { WikiShell } from "./wiki-shell";
import type { ModeDefinition } from "../registry";

export const wikiMode = {
  label: "wikiTheme",
  Shell: WikiShell,
  messages: {},
} as const satisfies ModeDefinition;
