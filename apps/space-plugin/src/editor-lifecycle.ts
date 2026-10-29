export interface EditorResource {
  flush(): Promise<void>;
  isSaved(): boolean;
  resume?(): Promise<void>;
}
export type EditorBinding = EditorResource & { node: string };

/** A mount owns its release token, even when the next mount opens the same node. */
export class EditorResources {
  current: EditorBinding | null = null;
  bind(node: string, resource: EditorResource) {
    const binding = { node, ...resource };
    this.current = binding;
    return () => {
      if (this.current === binding) this.current = null;
    };
  }
}

/** Finish releasing listeners and workers even when one SDK disposer fails. */
export function disposeEditorResources(
  actions: (() => void)[],
  report = (error: unknown) => console.error('Editor cleanup failed', error),
) {
  for (const action of actions) {
    try {
      action();
    } catch (error) {
      report(error);
    }
  }
}
