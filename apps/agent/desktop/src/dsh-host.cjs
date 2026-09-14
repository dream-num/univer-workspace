// Desktop application host. Published DSH packages remain unmodified.
const fs = require('node:fs');
const path = require('node:path');
const { createRequire, registerHooks } = require('node:module');
const { pathToFileURL } = require('node:url');

async function startDesktopHost(args) {
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
      let result;
      try {
        result = nextResolve(specifier, context);
      } catch (error) {
        const bare = !specifier.startsWith('.') && !specifier.startsWith('/') &&
          !specifier.startsWith('#') && !specifier.includes(':');
        if (!['ERR_MODULE_NOT_FOUND', 'MODULE_NOT_FOUND'].includes(error.code) || !bare ||
            !(context.parentURL?.startsWith(configRoot) || context.parentURL === loaderEntry)) throw error;
        result = nextResolve(specifier, { ...context, parentURL: profileAnchor });
      }
      // node-pty passes its helper path directly to native posix_spawn on macOS.
      // Loading the whole package from its physical unpacked location keeps
      // __dirname usable by the OS, which cannot traverse a virtual ASAR path.
      const archiveRoot = pathToFileURL(archive + path.sep).href;
      if (result.url.startsWith(archiveRoot) && result.url.includes('/node_modules/node-pty/')) {
        return { ...result, url: result.url.replace(archiveRoot, pathToFileURL(archive + '.unpacked' + path.sep).href) };
      }
      return result;
    },
  });
  const load = (name) => import(pathToFileURL(requireHost.resolve(name)).href);
  const host = await load('@deepseek-ai/dsh-app-boot');
  const { provideCmdline } = await load('@deepseek-ai/dsh-cmdline');
  const { DSH_LAUNCH_ENVIRONMENT_KEY } = await load('@deepseek-ai/dsh-launch-environment');
  const profile = host.loadProfileDirectory('workspace-desktop', path.join(archive, 'profile'),
    requireHost.resolve('@deepseek-ai/dsh/package.json'));
  const config = path.join(process.env.DSH_HOME, 'cordis.yml');
  try { fs.writeFileSync(config, '[]\n', { flag: 'wx', mode: 0o600 }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }

  // Electron runs this host and SDK child forks in Node mode with ASAR support.
  if (!process.versions.electron || process.env.ELECTRON_RUN_AS_NODE !== '1')
    throw new Error('Desktop DSH host requires Electron in Node mode');
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
      provideCmdline(ctx, { args, exit: stop, ready: readiness });
    }, profileAnchor);
  ready = true;
  for (const listener of listeners) listener();
  listeners.clear();
  // Keep start-local's account lifecycle active until normal shutdown. The
  // parent still owns process-tree termination for unresponsive tools.
  return new Promise(() => {
    for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => void stop());
    process.once('disconnect', () => void stop());
  });
}

module.exports = { startDesktopHost };
