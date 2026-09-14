// Experimental application host. Published DSH packages remain unmodified.
const fs = require('node:fs');
const path = require('node:path');
const { createRequire, registerHooks } = require('node:module');
const { pathToFileURL } = require('node:url');

async function start() {
  const archive = path.join(__dirname, 'host.asar');
  const requireHost = createRequire(path.join(archive, 'package.json'));
  const profileAnchor = pathToFileURL(path.join(archive, 'profile/package.json')).href;
  const configRoot = pathToFileURL(process.env.DSH_HOME + path.sep).href;
  const loaderEntry = pathToFileURL(requireHost.resolve('@deepseek-ai/cordis-plugin-loader')).href;

  // DSH's native internal-loader helper does not support Electron 44. Its
  // fallback imports from the Loader package; dynamic rows also import from
  // writable configuration directories. Resolve only misses at these two
  // application boundaries against the packaged profile, preserving normal
  // package resolution and import/require conditions everywhere else.
  // Remove when published DSH supports both paths in an embedded ASAR host.
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      try {
        return nextResolve(specifier, context);
      } catch (error) {
        const bare = !specifier.startsWith('.') && !specifier.startsWith('/') &&
          !specifier.startsWith('#') && !specifier.includes(':');
        if (!['ERR_MODULE_NOT_FOUND', 'MODULE_NOT_FOUND'].includes(error.code) || !bare ||
            !(context.parentURL?.startsWith(configRoot) || context.parentURL === loaderEntry)) throw error;
        return nextResolve(specifier, { ...context, parentURL: profileAnchor });
      }
    },
  });
  const load = (name) => import(pathToFileURL(requireHost.resolve(name)).href);
  const host = await load('@deepseek-ai/dsh-app-boot');
  const { provideCmdline } = await load('@deepseek-ai/dsh-cmdline');
  const { DSH_LAUNCH_ENVIRONMENT_KEY } = await load('@deepseek-ai/dsh-launch-environment');
  const profile = host.loadProfileDirectory('workspace-desktop', path.join(archive, 'profile'),
    requireHost.resolve('@deepseek-ai/dsh/package.json'));
  const config = path.join(process.env.DSH_HOME, 'cordis.yml');
  fs.writeFileSync(config, '[]\n');

  // The Workspace readiness plugin uses Node IPC. Utility processes expose a
  // parent port instead. Descendant forks must interpret Electron as Node.
  process.send = (message, callback) => {
    process.parentPort.postMessage(message);
    callback?.(null);
    return true;
  };
  process.env.ELECTRON_RUN_AS_NODE = '1';
  let context;
  let stopping;
  let ready = false;
  const listeners = new Set();
  const readiness = {
    onReady(listener) {
      if (ready) { listener(); return () => {}; }
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const stop = (code = 0) => stopping ??= (async () => {
    await context?.fiber.dispose();
    hooks.deregister();
    process.exit(code);
  })();
  host.installFailLoud('workspace-desktop', process, () => context?.fiber.dispose());
  context = await host.boot('workspace-desktop', config,
    [...profile.layers.flatMap((layer) => layer.patches), ...profile.patches], (ctx) => {
      ctx.provide(DSH_LAUNCH_ENVIRONMENT_KEY, host.loadLayeredEnv('workspace-desktop'));
      provideCmdline(ctx, { args: process.argv.slice(2), exit: stop, ready: readiness });
    }, profileAnchor);
  ready = true;
  for (const listener of listeners) listener();
  listeners.clear();
  process.parentPort.on('message', (event) => {
    if (event.data?.type === 'stop') void stop();
  });
}

start().catch((error) => { console.error(error.stack); process.exit(1); });
