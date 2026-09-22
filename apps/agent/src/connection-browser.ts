/**
 * Transitional pre-boot adapter: requests belong to the account that rendered
 * this document. The global patches are not a supported DSH integration API.
 * Remove them once published DSH socket/resource URL hooks and explicit
 * Workspace transports cover every protected request. Do not expand the patches.
 * See docs/design/agent-transport-boundary.md for ownership and exit criteria.
 */
export const connectionBrowserScript = `(() => {
  const version = globalThis.__UWH_CONNECTION_VERSION__;
  const nativeFetch = globalThis.fetch.bind(globalThis);
  const NativeWebSocket = globalThis.WebSocket;
  let refreshing = false;
  const owned = url => url.origin === location.origin && (url.pathname === '/api' || url.pathname.startsWith('/api/') || url.pathname === '/univer-workspace' || url.pathname.startsWith('/univer-workspace/') || url.pathname.startsWith('/auth/device/'));
  let checking;
  // Recover only after a transport loss, an account fence rejection, or page restore.
  // OAuth switches dispose the native mux; ordinary healthy tabs never poll.
  function check() {
    if (checking || refreshing) return;
    checking = (async () => {
      const deadline = Date.now() + 45000;
      do {
        try {
          const response = await nativeFetch('/auth/connection/status', {cache: 'no-store', signal: AbortSignal.timeout(3000)});
          if (!response.ok) return;
          const state = await response.json();
          if (state.ready) {
            if (state.version !== version && !refreshing) {
              refreshing = true;
              location.replace('/');
            }
            return;
          }
        } catch { return; }
        await new Promise(resolve => setTimeout(resolve, 500));
      } while (Date.now() < deadline);
    })().finally(() => { checking = undefined; });
  }
  function connectionFetch(send, input, init) {
    const request = new Request(input instanceof Request ? input : new URL(input, location.href), init);
    if (!owned(new URL(request.url))) return send(request);
    const headers = new Headers(request.headers);
    headers.set('x-uwh-connection', version);
    return send(request, {headers}).then(response => {
      if (response.status === 409 || response.status === 503) check();
      return response;
    });
  }
  globalThis.fetch = (input, init) => connectionFetch(nativeFetch, input, init);
  // DSH's default upload Worker has its own fetch/XHR globals, outside the
  // document's connection fence. Its published pre-boot carrier hook lets us
  // pin uploads to this document without altering DSH or the server fence.
  const upload = globalThis.__DSH_FILE_UPLOAD__;
  const uploadFetch = upload ? upload.fetch.bind(upload) : nativeFetch;
  globalThis.__DSH_FILE_UPLOAD__ = {
    ...upload,
    fetch: (input, init) => connectionFetch(uploadFetch, input, init),
  };
  // DSH alpha.4 exports use a detached download anchor after a fetch HEAD check.
  // Navigation cannot send the fetch header. Pin the URL without weakening the
  // server fence; remove this adapter when DSH exposes a download URL hook.
  const nativeAnchorClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    const url = new URL(this.href, location.href);
    if (this.hasAttribute('download') && owned(url) && !url.searchParams.has('uwhConnection')) {
      url.searchParams.set('uwhConnection', version);
      this.href = url.href;
    }
    return nativeAnchorClick.call(this);
  };
  globalThis.WebSocket = class extends NativeWebSocket {
    constructor(input, protocols) {
      const url = new URL(input, location.href);
      const http = new URL(url); http.protocol = http.protocol === 'wss:' ? 'https:' : 'http:';
      if (owned(http)) url.searchParams.set('uwhConnection', version);
      super(url.href, protocols);
      if (owned(http) && url.pathname === "/api/remote.mux") this.addEventListener("close", check);
    }
  };
  addEventListener('pageshow', check);
})();`;
