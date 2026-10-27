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
  track: HTTPInterceptorFn;
} {
  const pending = new Set<Promise<void>>();
  return {
    isIdle: () => pending.size === 0,
    track: (request, next) =>
      new Observable((subscriber) => {
        let settled!: () => void;
        const operation = new Promise<void>((resolve) => {
          settled = resolve;
        });
        pending.add(operation);
        const subscription = next(request).subscribe(subscriber);
        return () => {
          subscription.unsubscribe();
          pending.delete(operation);
          settled();
        };
      }),
    async drain() {
      while (pending.size) await Promise.allSettled([...pending]);
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
              subscriber.error(new HTTPResponseError({ request, error }));
          });
        pending.add(operation);
        void operation.finally(() => pending.delete(operation));
        return () => abort.abort();
      });
    },
  };
}
