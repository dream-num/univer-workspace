const SCHEME = 'univer-workspace';

function parseLoginCallback(value) {
  if (typeof value !== 'string' || value.length > 4096) return;
  try {
    const url = new URL(value);
    if (url.protocol !== `${SCHEME}:` || url.hostname !== 'login' || url.port ||
      url.username || url.password || !['', '/'].includes(url.pathname) || url.search) return;
    const params = new URLSearchParams(url.hash.slice(1));
    if ([...params.keys()].some(key => !['state', 'code', 'error'].includes(key)) ||
      [...params.keys()].some(key => params.getAll(key).length !== 1)) return;
    const state = params.get('state'), code = params.get('code'), error = params.get('error');
    if (!state || !/^[\w-]{43}$/.test(state) || (!!code === !!error) || (code?.length ?? 0) > 2048) return;
    return { state, ...(code ? { code } : { error }) };
  } catch { return; }
}

function createLoginController({ origin, fetch, openExternal, connected, now = Date.now }) {
  let active, starting = false, completing = false;
  const post = async (path, body) => {
    const response = await fetch(`${origin}${path}`, {
      method: 'POST', credentials: 'include', redirect: 'error',
      headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error('workspace_login_failed');
    return response.json();
  };
  return {
    async start() {
      if (starting || completing) throw new Error('workspace_login_busy');
      starting = true;
      active = undefined;
      try {
        const result = await post('/auth/oauth/desktop/start', {});
        const url = new URL(result.authorizationUrl);
        if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password ||
          !/^[\w-]{43}$/.test(result.state) || !Number.isFinite(result.expiresAt) || result.expiresAt <= now())
          throw new Error('workspace_login_failed');
        active = result;
        await openExternal(url.href);
      } catch { active = undefined; throw new Error('workspace_login_failed'); }
      finally { starting = false; }
    },
    async accept(value) {
      const callback = parseLoginCallback(value);
      if (!callback) throw new Error('workspace_login_invalid');
      if (completing) return false;
      if (!active || callback.state !== active.state || active.expiresAt <= now())
        throw new Error('workspace_login_expired');
      active = undefined;
      if (callback.error) throw new Error('workspace_login_cancelled');
      completing = true;
      try {
        const result = await post('/auth/oauth/desktop/complete', callback);
        if (result.connected !== true || typeof result.version !== 'string') throw new Error('workspace_login_failed');
        // Account-owned DSH routes are rebuilt asynchronously after connect().
        const deadline = now() + 45000;
        while (now() < deadline) {
          try {
            const response = await fetch(`${origin}/api/uwh/me`, { credentials: 'include', cache: 'no-store',
              headers: { 'x-uwh-connection': result.version }, signal: AbortSignal.timeout(3000) });
            const me = response.ok ? await response.json() : null;
            if (me?.connected === true && me.switching === false) { await connected(); return true; }
          } catch { /* The account's services may still be restarting. */ }
          await new Promise(resolve => setTimeout(resolve, 500));
        }
        throw new Error('workspace_login_not_ready');
      } finally { completing = false; }
    },
  };
}
module.exports = { SCHEME, parseLoginCallback, createLoginController };
