import assert from 'node:assert/strict';
import { test } from 'node:test';
import { firstValueFrom, Observable } from 'rxjs';
import {
  HTTPService,
  HTTPRequest,
  HTTPResponseError,
  HTTPHeaders,
} from '@univerjs/network';
import { editorHTTP } from '../lib/editor-http.js';

test('SDK transport forwards changesets as JSON and preserves HTTP permission failures', async () => {
  const messages = [];
  const http = editorHTTP(async (input) => {
    messages.push(input);
    return {
      status: 403,
      statusText: 'Forbidden',
      body: '{"error":{"message":"Edit denied"}}',
    };
  });
  await assert.rejects(
    firstValueFrom(
      http.send(
        new HTTPRequest('POST', '/universer-api/comb/1/unit/u/new_changes', {
          headers: new HTTPHeaders(),
          body: { revision: 9 },
          responseType: 'json',
        }),
      ),
    ),
    (e) =>
      e instanceof HTTPResponseError &&
      e.status === 403 &&
      e.error.error.message === 'Edit denied',
  );
  assert.equal(messages[0].body, '{"revision":9}');
  await http.drain();
});

test('teardown drain includes HTTP requests deferred by an SDK interceptor', async () => {
  let release;
  const ready = new Promise((r) => (release = r)),
    messages = [];
  const http = editorHTTP(async (input) => {
    messages.push(input);
    return { status: 200, statusText: 'OK', body: '{"ok":true}' };
  });
  const service = new HTTPService(http);
  service.registerHTTPInterceptor({
    priority: -100000,
    interceptor: http.track,
  });
  service.registerHTTPInterceptor({
    interceptor: (request, next) =>
      new Observable((subscriber) => {
        let subscription;
        void ready.then(() => {
          subscription = next(request).subscribe(subscriber);
        });
        return () => subscription?.unsubscribe();
      }),
  });
  const response = service.get('/universer-api/authz/allowed');
  let drained = false;
  const drain = http.drain().then(() => {
    drained = true;
  });
  await Promise.resolve();
  assert.equal(drained, false);
  assert.equal(messages.length, 0);
  release();
  assert.deepEqual((await response).body, { ok: true });
  await drain;
  assert.equal(drained, true);
  service.dispose();
});

test('SDK multipart uploads use the authenticated streaming carrier', async () => {
  const form = new FormData();
  form.append('file', new Blob(['image'], { type: 'image/png' }), 'image.png');
  let sent;
  const http = editorHTTP(
    async () => { throw new Error('JSON carrier must not receive multipart data'); },
    async (input) => {
      sent = input;
      return { status: 201, statusText: 'Created', body: '{"FileId":"asset-1"}' };
    },
  );
  const result = await firstValueFrom(http.send(new HTTPRequest('POST', '/universer-api/stream/file/upload?source=3', {
    headers: new HTTPHeaders(), body: form, responseType: 'json',
  })));
  assert.equal(sent.body, form);
  assert.equal(sent.path, '/universer-api/stream/file/upload?source=3');
  assert.deepEqual(result.body, { FileId: 'asset-1' });
  await http.drain();
});
