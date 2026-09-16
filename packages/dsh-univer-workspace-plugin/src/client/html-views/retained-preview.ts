/**
 * DSH rc.1 cannot veto native tab closing. Keep the mounted page until flush
 * succeeds; a failed save stays recoverable. Remove this retention adapter when
 * the public Sidecar contract supports asynchronous leave guards.
 */
export function retainUntilSaved(options: {
  flush: () => Promise<void>;
  dispose: () => void;
  onSaving: () => void;
  onError: (error: unknown) => void;
}) {
  let disposed = false;
  let saving: Promise<void> | undefined;
  return {
    discard(): void {
      if (disposed || saving) return;
      disposed = true;
      options.dispose();
    },
    saveAndClose(): Promise<void> {
      if (disposed) return Promise.resolve();
      if (saving) return saving;
      options.onSaving();
      saving = Promise.resolve()
        .then(options.flush)
        .then(() => {
          disposed = true;
          options.dispose();
        }, options.onError)
        .finally(() => {
          saving = undefined;
        });
      return saving;
    },
  };
}
