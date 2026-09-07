/** Installed before DSH modules: requests belong to the account that rendered this document. */
export const connectionBrowserScript = `(() => {
  const version = globalThis.__UWH_CONNECTION_VERSION__;
  const nativeFetch = globalThis.fetch.bind(globalThis);
  const NativeWebSocket = globalThis.WebSocket;
  let refreshing = false;
  const owned = url => url.origin === location.origin && (url.pathname === '/api' || url.pathname.startsWith('/api/') || url.pathname === '/univer-workspace' || url.pathname.startsWith('/univer-workspace/') || url.pathname.startsWith('/auth/device/'));
  async function check() {
    try {
      const response = await nativeFetch('/auth/connection/status', {cache:'no-store'});
      const state = await response.json();
      if (state.version !== version && state.ready && !refreshing) {
        refreshing = true;
        location.replace('/');
      }
    } catch {}
  }
  globalThis.fetch = (input, init) => {
    const request = new Request(input instanceof Request ? input : new URL(input, location.href), init);
    if (!owned(new URL(request.url))) return nativeFetch(request);
    const headers = new Headers(request.headers);
    headers.set('x-uwh-connection', version);
    return nativeFetch(request, {headers}).then(response => {
      if (response.status === 409 || response.status === 503) void check();
      return response;
    });
  };
  globalThis.WebSocket = class extends NativeWebSocket {
    constructor(input, protocols) {
      const url = new URL(input, location.href);
      const http = new URL(url); http.protocol = http.protocol === 'wss:' ? 'https:' : 'http:';
      if (owned(http)) url.searchParams.set('uwhConnection', version);
      super(url.href, protocols);
    }
  };
  setInterval(check, 1000);
  addEventListener('pageshow', check);
})();`;
