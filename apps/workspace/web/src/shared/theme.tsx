import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";

export type WorkspaceTheme = "wiki" | "repository";

export function readWorkspaceTheme(): WorkspaceTheme {
  try {
    return window.localStorage.getItem("univer-workspace-layout-theme") === "repository" ? "repository" : "wiki";
  } catch {
    return "wiki";
  }
}

export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

interface IUniverThemeController {
  toggleDarkMode(isDarkMode: boolean): void;
}

const STORAGE_KEY = "univer-workspace-theme";
const mediaQuery = "(prefers-color-scheme: dark)";

function readStoredPreference(): ThemePreference {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") {
      return stored;
    }
  } catch {
    // localStorage may be unavailable; fall through to the default.
  }
  return "system";
}

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference !== "system") return preference;
  return window.matchMedia(mediaQuery).matches ? "dark" : "light";
}

export function syncUniverTheme(
  univerAPI: IUniverThemeController,
  resolvedTheme: ResolvedTheme
) {
  const isDarkMode = resolvedTheme === "dark";
  univerAPI.toggleDarkMode(isDarkMode);
  document.documentElement.classList.toggle("univer-dark", isDarkMode);
}

function applyTheme(resolved: ResolvedTheme) {
  const root = document.documentElement;
  root.classList.toggle("dark", resolved === "dark");
  root.style.colorScheme = resolved;
}

interface ThemeContextValue {
  readonly workspaceTheme: WorkspaceTheme;
  readonly setWorkspaceTheme: (theme: WorkspaceTheme) => void;
  readonly theme: ThemePreference;
  readonly resolvedTheme: ResolvedTheme;
  readonly setTheme: (theme: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: PropsWithChildren) {
  const [workspaceTheme, setWorkspaceTheme] = useState(readWorkspaceTheme);
  useEffect(() => {
    try {
      window.localStorage.setItem("univer-workspace-layout-theme", workspaceTheme);
    } catch {
      // The in-memory selection still works when browser storage is unavailable.
    }
  }, [workspaceTheme]);
  const [theme, setThemeState] = useState<ThemePreference>(() =>
    readStoredPreference()
  );
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() =>
    resolveTheme(readStoredPreference())
  );

  useEffect(() => {
    const apply = () => {
      const resolved = resolveTheme(theme);
      setResolvedTheme(resolved);
      applyTheme(resolved);
    };

    apply();
    try {
      window.localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Ignore persistence failures; the in-memory theme still applies.
    }

    if (theme !== "system") return;
    const media = window.matchMedia(mediaQuery);
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      workspaceTheme,
      setWorkspaceTheme,
      theme,
      resolvedTheme,
      setTheme: setThemeState,
    }),
    [theme, resolvedTheme, workspaceTheme]
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return value;
}
