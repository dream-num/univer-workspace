export class ConversionJobQueue {
  private active = 0;
  private readonly waiting = new Set<() => void>();

  constructor(private readonly capacity: number) {}

  async acquire(signal: AbortSignal): Promise<() => void> {
    signal.throwIfAborted();
    if (this.active >= this.capacity) {
      await new Promise<void>((resolve, reject) => {
        const abort = () => {
          this.waiting.delete(start);
          reject(signal.reason);
        };
        const start = () => {
          signal.removeEventListener("abort", abort);
          resolve();
        };
        this.waiting.add(start);
        signal.addEventListener("abort", abort, { once: true });
      });
    } else {
      this.active += 1;
    }
    if (signal.aborted) {
      this.release();
      signal.throwIfAborted();
    }
    return () => this.release();
  }

  private release() {
    const next = this.waiting.values().next().value;
    if (next) {
      this.waiting.delete(next);
      next();
    } else {
      this.active -= 1;
    }
  }
}
