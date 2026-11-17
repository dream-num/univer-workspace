import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";

const STORAGE_KEY = "univer-workspace-layout-theme";
const ONBOARDING_KEY = "univer-workspace-view-onboarding-complete";

export function parseUiMode<M extends string>(raw: unknown, known: readonly M[], fallback: M): M {
  return known.find((mode) => mode === raw) ?? fallback;
}

interface UiModeContextValue {
  readonly mode: string;
  readonly needsOnboarding: boolean;
  readonly setMode: (mode: string) => void;
}

const UiModeContext = createContext<UiModeContextValue | null>(null);

export function UiModeProvider<M extends string>({
  modes,
  fallback,
  children,
}: PropsWithChildren<{ readonly modes: readonly M[]; readonly fallback: M }>) {
  const readPreference = useCallback(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      return {
        mode: parseUiMode(stored, modes, fallback),
        needsOnboarding: window.localStorage.getItem(ONBOARDING_KEY) !== "true",
      };
    } catch {
      return { mode: fallback, needsOnboarding: true };
    }
  }, [modes, fallback]);
  const [preference, setPreference] = useState(readPreference);

  useEffect(() => {
    if (!preference.needsOnboarding) return;
    const sync = (event: StorageEvent) => {
      if (event.key === ONBOARDING_KEY || event.key === STORAGE_KEY) setPreference(readPreference());
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, [preference.needsOnboarding, readPreference]);

  const setMode = useCallback((next: string) => {
    const mode = parseUiMode(next, modes, fallback);
    setPreference({ mode, needsOnboarding: false });
    try {
      window.localStorage.setItem(STORAGE_KEY, mode);
      window.localStorage.setItem(ONBOARDING_KEY, "true");
    } catch {
      // Storage 不可用时，仍保留内存中的选择。
    }
  }, [modes, fallback]);
  const value = useMemo(() => ({ ...preference, setMode }), [preference, setMode]);

  return <UiModeContext.Provider value={value}>{children}</UiModeContext.Provider>;
}

export function useUiMode(): UiModeContextValue {
  const value = useContext(UiModeContext);
  if (!value) throw new Error("useUiMode must be used within UiModeProvider");
  return value;
}
