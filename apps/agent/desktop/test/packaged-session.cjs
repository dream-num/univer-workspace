// Exercise published DSH session creation and preset composition without a
// Workspace account or an LLM request. All writable state belongs to this probe.
const assert = require('node:assert/strict');
const { mkdtemp, mkdir, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { pathToFileURL } = require('node:url');
const { createRequire, registerHooks } = require('node:module');
const net = require('node:net');

async function main() {
  const runtime = resolve(process.argv[2]);
  const archive = join(runtime, 'host.asar');
  const root = await mkdtemp(join(tmpdir(), 'uwa session smoke '));
  let context;
  let hooks;
  try {
    const data = join(root, 'data');
    await mkdir(data);
    const port = await new Promise((done, reject) => {
      const server = net.createServer();
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        server.close(() => done(port));
      });
    });
    Object.assign(process.env, {
      NODE_ENV: 'production', UWA_DESKTOP: '1', DSH_HOME: data,
      UWH_DSH_DATA_HOME: data, UWH_CONNECTION_STATE_PATH: join(data, 'connection.json'),
      UWH_SHARED_SETTINGS_PATH: join(data, 'settings.yaml'),
      UWH_SHARED_CREDENTIALS_PATH: join(data, '.credentials.yaml'),
      UWA_DESKTOP_CLIENT_ROOT: join(runtime, 'desktop-client'),
      UWH_BIND_HOST: '127.0.0.1', UWH_PUBLIC_HOST: '127.0.0.1',
      UWH_PUBLIC_ORIGIN: `http://127.0.0.1:${port}`,
    });
    const host = require(join(runtime, 'dsh-host.cjs'));
    hooks = registerHooks(host.createHostResolveHook(archive, data));
    const requireHost = createRequire(join(archive, 'package.json'));
    const requireProfile = createRequire(join(archive, 'profile/package.json'));
    const load = (name, anchor = requireHost) => import(pathToFileURL(anchor.resolve(name)).href);
    const app = await load('@deepseek-ai/dsh-app-boot');
    const { provideCmdline } = await load('@deepseek-ai/dsh-cmdline');
    const { DSH_LAUNCH_ENVIRONMENT_KEY } = await load('@deepseek-ai/dsh-launch-environment');
    const profile = app.loadProfileDirectory('session-smoke', join(archive, 'profile'),
      requireHost.resolve('@deepseek-ai/dsh/package.json'));
    context = await app.boot('session-smoke', join(archive, 'desktop.cordis.yml'),
      [...profile.layers.flatMap(layer => layer.patches), ...profile.patches], ctx => {
        ctx.provide(DSH_LAUNCH_ENVIRONMENT_KEY, app.loadLayeredEnv('session-smoke'));
        provideCmdline(ctx, { args: ['--port', String(port), '--no-open', '--trusted-host', '127.0.0.1'],
          exit: () => {}, ready: { onReady: () => () => {} } });
      }, pathToFileURL(join(archive, 'package.json')).href);
    const installedScope = await load('@deepseek-ai/dsh-scope');
    const profileScope = await load('@deepseek-ai/dsh-scope', requireProfile);
    assert.equal(profileScope, installedScope, 'profile and host must share the scope module');
    const sessions = [];
    for (let index = 0; index < 2; index++) {
      const result = await context.get('typertGateway').invoke({
        namespace: 'session', method: 'create', args: { request: { cwd: join(root, 'workspace'), agentPreset: 'standard' } },
      });
      assert.equal(result.agentPreset, 'standard');
      const agent = context.get('agents').get(result.sessionId);
      assert.ok(agent);
      const scope = installedScope.scopeOf(agent.ctx);
      assert.ok(scope);
      assert.equal(profileScope.scopeOf(agent.ctx), scope);
      assert.equal(context.get('agentPresets').composedPreset(agent.ctx), 'standard');
      assert.ok(context.get('tools').view(scope).visible.size > 0, 'preset tools must be visible to the session');
      sessions.push(result.sessionId);
    }
    assert.notEqual(sessions[0], sessions[1]);
    console.log('Packaged DSH created two scoped sessions with the standard preset and visible tools.');
  } finally {
    await context?.fiber.dispose();
    hooks?.deregister();
    await rm(root, { recursive: true, force: true });
  }
}

main().then(() => process.exit(0), error => { console.error(error); process.exit(1); });
