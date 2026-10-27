import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

/** SDK 1.1.0 embeds a development WebSocket fallback. Space always supplies
 * its authenticated endpoint explicitly. Make a missing configuration fail
 * closed in the distributed bundle instead of contacting that local service.
 * Installed SDK files stay unchanged. Remove when upstream has no dev default. */
export function releaseSdkDefaults() {
  return { name: 'explicit-workspace-endpoint', setup(build) {
    build.onLoad({ filter: /@univerjs-pro\/collaboration-client\/lib\/es\/index\.js$/ }, async ({ path }) => {
      const directory = dirname(path);
      const pkg = JSON.parse(await readFile(resolve(directory, '../../package.json'), 'utf8'));
      const contents = await readFile(path, 'utf8');
      const development = 'ws://127.0.0.1:8000/universer-api/comb/connect';
      if (pkg.version !== '1.1.0' || contents.split(development).length !== 3)
        throw new Error('Re-audit the published collaboration-client default before releasing this SDK version.');
      return { contents: contents.replaceAll(development, 'wss://workspace-endpoint-required.invalid/universer-api/comb/connect'), loader: 'js', resolveDir: directory };
    });
  } };
}
