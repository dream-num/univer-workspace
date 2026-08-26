export interface ClientPlugin {
  readonly apply: (context: unknown) => void;
}

export function createClientPlugin(): ClientPlugin {
  return {
    apply(_context: unknown): void {
      // The 401 login redirect, session input guard, and the workspace
      // origin settings row are registered here with the harness core.
    },
  };
}
