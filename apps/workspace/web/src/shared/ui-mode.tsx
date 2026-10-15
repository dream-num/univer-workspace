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

export function parseUiMode<M extends string>(raw: unknown, known: readonly M[], fallback: M): M {
  return known.find((mode) => mode === raw) ?? fallback;
}

interface UiModeContextValue {
  readonly mode: string;
  readonly setMode: (mode: string) => void;
}

const UiModeContext = createContext<UiModeContextValue | null>(null);

export function UiModeProvider<M extends string>({
  modes,
  fallback,
  children,
}: PropsWithChildren<{ readonly modes: readonly M[]; readonly fallback: M }>) {
  const [mode, setModeState] = useState(() => {
    try {
      return parseUiMode(window.localStorage.getItem(STORAGE_KEY), modes, fallback);
    } catch {
      return fallback;
    }
  });
  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      // Storage 不可用时，仍保留内存中的选择。
    }
  }, [mode]);
  const setMode = useCallback(
    (next: string) => setModeState(parseUiMode(next, modes, fallback)),
    [modes, fallback],
  );
  const value = useMemo(() => ({ mode, setMode }), [mode, setMode]);

  return <UiModeContext.Provider value={value}>{children}</UiModeContext.Provider>;
}

export function useUiMode(): UiModeContextValue {
  const value = useContext(UiModeContext);
  if (!value) throw new Error("useUiMode must be used within UiModeProvider");
  return value;
}
