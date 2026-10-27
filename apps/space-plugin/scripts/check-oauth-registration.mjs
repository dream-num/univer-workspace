/** Public, anonymous registration probe; never prints state, code or credentials. */
import { randomBytes, createHash } from 'node:crypto';
const origin = process.env.SPACE_TEST_ENDPOINT ?? 'https://space.univer.ai';
for (const port of [3101, 43181]) {
  const url = new URL('/api/auth/authorize', origin);
  url.search = new URLSearchParams({ client_id: 'univer-workspace-harness',
    redirect_uri: `http://127.0.0.1:${port}/auth/oauth/callback`,
    state: randomBytes(32).toString('base64url'),
    code_challenge: createHash('sha256').update(randomBytes(48)).digest('base64url'),
    response_type: 'code', code_challenge_method: 'S256', scope: 'identity session' }).toString();
  const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(10000) });
  const error = response.status >= 400 ? await response.json() : null;
  const location = response.headers.get('location');
  console.log(JSON.stringify({ origin: url.origin, callback: `http://127.0.0.1:${port}/auth/oauth/callback`,
    status: response.status, nextPath: location ? new URL(location, origin).pathname : null,
    error: error?.error?.code ?? null }));
}
