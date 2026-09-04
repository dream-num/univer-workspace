/** Public contracts shared by the embedded Viewer façade and its runtime. */

import type { LocaleType, Univer } from "@univerjs/core";
import type { FUniver } from "@univerjs/core/facade";
import type { ViewerUnitType } from "../viewer-types.ts";

export type { ViewerUnitType } from "../viewer-types.ts";

/** Which collaboration surface the viewer attaches to. */
export type ViewerScope =
  | { readonly kind: "trunk" }
  | { readonly kind: "worktree"; readonly worktreeId: string }
  /** A read-only snapshot produced by the Worktree merge evaluator. */
  | { readonly kind: "mergePreview"; readonly worktreeId: string };

export interface ViewerOptions {
  container: string;
  unitId: string;
  unitType: ViewerUnitType;
  /** The collaboration source: trunk, an editable draft, or a ready merge preview. */
  scope: ViewerScope;
  /** Allow the user to edit this unit (submit changesets). Default false = read-only viewer. */
  editable: boolean;
  /** Initial Univer appearance. The handle can switch this without rebuilding. */
  darkMode?: boolean;
  locale: LocaleType;
  license: string;
  user: {
    readonly id: string;
    readonly displayName: string;
    readonly avatarUrl: string | null;
  };
}

export interface ViewerHandle {
  setDarkMode(isDarkMode: boolean): void;
  setLocale(locale: LocaleType): Promise<void>;
  dispose(): void;
}

/** Debug handles exposed while one embedded Viewer is alive. */
declare global {
  interface Window {
    univer?: Univer;
    univerAPI?: ReturnType<typeof FUniver.newAPI>;
  }
}
