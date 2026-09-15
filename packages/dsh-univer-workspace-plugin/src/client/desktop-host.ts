/** Optional capabilities provided only by the sandboxed Desktop preload. */
export interface DesktopDiagnosticEvent {
  time?: string;
  phase?: string;
  elapsedMs?: number;
  code?: string;
  httpStatus?: number;
  percent?: number;
  transferred?: number;
  total?: number;
  bytesPerSecond?: number;
  version?: string;
}
export interface DesktopDiagnostics {
  collectedAt: string;
  application: {
    version: string; packaged: boolean; updatesEnabled: boolean;
    electron: string; node: string; dsh: string | null; platform: string; arch: string; osRelease: string;
  };
  directories: Record<string, string>;
  update: DesktopDiagnosticEvent;
  startup: DesktopDiagnosticEvent[];
  previousStartup: DesktopDiagnosticEvent[];
  recentUpdates: DesktopDiagnosticEvent[];
}
declare global {
  interface Window {
    readonly workspaceDesktop?: {
      openUpdates: () => Promise<void>;
      diagnostics: () => Promise<DesktopDiagnostics>;
      openDirectory: (id: string) => Promise<void>;
      exportDiagnostics: () => Promise<boolean>;
    };
  }
}
