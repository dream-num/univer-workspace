export interface ClientPlugin {
  readonly apply: (context: unknown) => void;
}

export function createClientPlugin(): ClientPlugin {
  return {
    apply(_context: unknown): void {
      // The workspace theme token overrides and the branded sidebar slot
      // are registered here with the skin implementation.
    },
  };
}
