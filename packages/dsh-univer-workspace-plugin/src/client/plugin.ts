export interface ClientPlugin {
  readonly apply: (context: unknown) => void;
}

export function createClientPlugin(): ClientPlugin {
  return {
    apply(_context: unknown): void {
      // The space-centric sidebar, conversation workspace picker, univer
      // tool preview cards, and the floating viewer windows are registered
      // here in the capability phases.
    },
  };
}
