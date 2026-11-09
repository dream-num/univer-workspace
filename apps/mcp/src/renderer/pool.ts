import { busyError, isInputError, timeoutError, unavailableError } from "./errors.js";

export interface RuntimePoolOptions<R extends { close(): Promise<void> }> {
  readonly create: () => Promise<R>;
  readonly max: number;
  readonly queueTimeoutMs: number;
  readonly operationTimeoutMs: number;
  readonly onCreate?: () => void;
  readonly onDiscard?: () => void;
}

// Temporary deviation from architecture 7.1: runtimes are reused across requests and users until
// Stage G brings per-task isolation. Every operation still passes its full unit, so a runtime keeps
// no request state of its own.
export class RuntimePool<R extends { close(): Promise<void> }> {
  readonly #idle: R[] = [];
  readonly #live = new Set<R>();
  readonly #waiters = new Set<() => void>();
  #creating = 0;
  #closed = false;

  constructor(private readonly options: RuntimePoolOptions<R>) {}

  get stats() {
    return { idle: this.#idle.length, busy: this.#live.size - this.#idle.length };
  }

  /** Lease one runtime for one operation. An input error returns it; any other failure closes it. */
  async run<T>(
    operation: (runtime: R, signal: AbortSignal) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<{ value: T; cold: boolean }> {
    const { runtime, cold } = await this.#lease(signal);
    if (signal?.aborted) {
      this.#release(runtime);
      throw signal.reason;
    }
    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason ?? timeoutError());
    const timer = setTimeout(
      () => controller.abort(timeoutError()),
      this.options.operationTimeoutMs,
    );
    signal?.addEventListener("abort", abort, { once: true });
    const aborted = new Promise<never>((_resolve, reject) =>
      controller.signal.addEventListener("abort", () => reject(controller.signal.reason), {
        once: true,
      }),
    );
    try {
      const value = await Promise.race([operation(runtime, controller.signal), aborted]);
      this.#release(runtime);
      return { value, cold };
    } catch (error) {
      if (!controller.signal.aborted && isInputError(error)) this.#release(runtime);
      else {
        this.options.onDiscard?.();
        await this.#close(runtime);
      }
      throw error;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    }
  }

  async close(): Promise<void> {
    this.#closed = true;
    for (const wake of [...this.#waiters]) wake();
    await Promise.all([...this.#live].map((runtime) => this.#close(runtime)));
  }

  async #lease(signal: AbortSignal | undefined): Promise<{ runtime: R; cold: boolean }> {
    const deadline = Date.now() + this.options.queueTimeoutMs;
    for (;;) {
      if (this.#closed) throw unavailableError();
      signal?.throwIfAborted();
      const idle = this.#idle.pop();
      if (idle) return { runtime: idle, cold: false };
      if (this.#live.size + this.#creating < this.options.max)
        return { runtime: await this.#create(), cold: true };
      await this.#wait(deadline - Date.now(), signal);
    }
  }

  async #create(): Promise<R> {
    this.#creating++;
    const creation = this.options.create();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const runtime = await Promise.race([
        creation,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(timeoutError()), this.options.operationTimeoutMs);
        }),
      ]);
      if (this.#closed) throw unavailableError();
      this.#live.add(runtime);
      this.options.onCreate?.();
      return runtime;
    } catch (error) {
      void creation.then(
        (late) => late.close(),
        () => {},
      );
      throw error;
    } finally {
      clearTimeout(timer);
      this.#creating--;
      this.#wakeOne();
    }
  }

  #wait(ms: number, signal: AbortSignal | undefined): Promise<void> {
    if (ms <= 0) throw busyError();
    return new Promise<void>((resolve, reject) => {
      const done = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        this.#waiters.delete(wake);
      };
      const wake = () => {
        done();
        resolve();
      };
      const onAbort = () => {
        done();
        reject(signal?.reason);
      };
      const timer = setTimeout(() => {
        done();
        reject(busyError());
      }, ms);
      signal?.addEventListener("abort", onAbort, { once: true });
      this.#waiters.add(wake);
    });
  }

  #wakeOne() {
    const [wake] = this.#waiters;
    wake?.();
  }

  #release(runtime: R) {
    if (!this.#live.has(runtime)) return;
    this.#idle.push(runtime);
    this.#wakeOne();
  }

  async #close(runtime: R) {
    if (!this.#live.delete(runtime)) return;
    const index = this.#idle.indexOf(runtime);
    if (index >= 0) this.#idle.splice(index, 1);
    this.#wakeOne();
    await runtime.close().catch(() => {});
  }
}
