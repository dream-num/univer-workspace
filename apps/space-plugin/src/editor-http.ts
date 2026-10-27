import { Observable } from 'rxjs';
import {
  HTTPHeaders,
  HTTPResponse,
  HTTPResponseError,
  type IHTTPImplementation,
  type HTTPRequest,
  type HTTPInterceptorFn,
} from '@univerjs/network';

export type EditorUpload = (input: { path: string; method: string; body: FormData }, signal: AbortSignal) => Promise<{ status: number; statusText: string; body: string }>;

export type EditorRequest = (
  input: { path: string; method: string; body: string | null },
  signal: AbortSignal,
) => Promise<{ status: number; statusText: string; body: string }>;

/** SDK transport at the existing authenticated DSH Connection boundary.
 * Cookies stay in Host memory; only SDK protocol JSON and single-use WS tickets cross it.
 * OT, batching, retries, permissions and socket reconnect remain owned by the SDK.
 */
export function editorHTTP(
  requestRemote: EditorRequest,
  uploadRemote?: EditorUpload,
): IHTTPImplementation & {
  drain(): Promise<void>;
  isIdle(): boolean;
  drainWrites(): Promise<void>;
  track: HTTPInterceptorFn;
} {
  const pending = new Set<Promise<void>>();
  const writes = new Set<Promise<void>>();
  type Result = Awaited<ReturnType<EditorRequest>>;
  const assetRequests = new Map<string, { abort: AbortController; consumers: number; operation: Promise<Result> }>();
  const assetRetryAt = new Map<string, number>();
  // SDK image consumers can request the same failing URL on every render. Share
  // concurrent signing reads and back off failures without delaying document writes.
  function requestAsset(input: Parameters<EditorRequest>[0], signal: AbortSignal): Promise<Result> {
    let job = assetRequests.get(input.path);
    if (!job) {
      const abort = new AbortController();
      const operation = Promise.resolve().then(async () => {
        await waitForAssetRetry(Math.max(0, (assetRetryAt.get(input.path) ?? 0) - Date.now()), abort.signal);
        try {
          const result = await requestRemote(input, abort.signal);
          let signed = false;
          if (result.status >= 200 && result.status < 300) {
            try { signed = typeof JSON.parse(result.body)?.url === 'string'; } catch { /* Preserve the original response below. */ }
          }
          assetRetryAt.set(input.path, Date.now() + (signed ? 1000 : 2000));
          return result;
        } catch (error) {
          if (!abort.signal.aborted) assetRetryAt.set(input.path, Date.now() + 2000);
          throw error;
        }
      }).finally(() => { if (assetRequests.get(input.path)?.operation === operation) assetRequests.delete(input.path); });
      job = { abort, consumers: 0, operation };
      assetRequests.set(input.path, job);
    }
    const current = job;
    current.consumers++;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      signal.removeEventListener('abort', release);
      if (--current.consumers === 0) {
        if (assetRequests.get(input.path) === current) assetRequests.delete(input.path);
        current.abort.abort();
      }
    };
    signal.addEventListener('abort', release, { once: true });
    if (signal.aborted) release();
    return current.operation.finally(release);
  }
  return {
    isIdle: () => pending.size === 0,
    track: (request, next) =>
      new Observable((subscriber) => {
        let settled!: () => void;
        const operation = new Promise<void>((resolve) => {
          settled = resolve;
        });
        pending.add(operation);
        if (!['GET', 'HEAD'].includes(request.method)) writes.add(operation);
        const subscription = next(request).subscribe(subscriber);
        return () => {
          subscription.unsubscribe();
          pending.delete(operation);
          writes.delete(operation);
          settled();
        };
      }),
    async drain() {
      while (pending.size) await Promise.allSettled([...pending]);
    },
    async drainWrites() {
      while (writes.size) await Promise.allSettled([...writes]);
    },
    send(request: HTTPRequest) {
      return new Observable((subscriber) => {
        const abort = new AbortController();
        const body = request.getBody();
        if (body !== null && typeof body !== 'string' && !uploadRemote) {
          subscriber.error(new Error('This editor upload transport is unavailable.'));
          return;
        }
        const input = { path: request.getUrlWithParams(), method: request.method, body };
        const sent = body !== null && typeof body !== 'string'
          ? uploadRemote!({ ...input, body }, abort.signal)
          : request.method === 'GET' && /^\/universer-api\/file\/[^/?]+\/sign-url(?:\?|$)/.test(input.path)
            ? requestAsset({ ...input, body }, abort.signal)
            : requestRemote({ ...input, body }, abort.signal);
        const operation = sent
          .then((result) => {
            if (abort.signal.aborted) return;
            const headers = new HTTPHeaders({
              'content-type': 'application/json',
            });
            let value: unknown = result.body;
            if (request.responseType === 'json')
              value = result.body ? JSON.parse(result.body) : null;
            else if (request.responseType !== 'text')
              throw new Error('Unsupported editor response format.');
            if (result.status < 200 || result.status >= 300) {
              subscriber.error(
                new HTTPResponseError({
                  request,
                  headers,
                  status: result.status,
                  statusText: result.statusText,
                  error: value,
                }),
              );
              return;
            }
            subscriber.next(
              new HTTPResponse({
                body: value,
                headers,
                status: result.status,
                statusText: result.statusText,
              }),
            );
            subscriber.complete();
          })
          .catch((error) => {
            if (!abort.signal.aborted)
              subscriber.error(new HTTPResponseError({ request,
                error: error instanceof Error ? { name: error.name, message: error.message } : error,
              }));
          });
        pending.add(operation);
        if (!['GET', 'HEAD'].includes(request.method)) writes.add(operation);
        void operation.finally(() => { pending.delete(operation); writes.delete(operation); });
        return () => abort.abort();
      });
    },
  };
}

function waitForAssetRetry(delay: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  if (!delay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, delay);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}
