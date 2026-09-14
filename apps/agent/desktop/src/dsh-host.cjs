// Desktop application host. Published DSH packages remain unmodified.
const fs = require('node:fs');
const path = require('node:path');
const { createRequire, registerHooks } = require('node:module');
const { pathToFileURL } = require('node:url');

// A scope tag and its registry must come from the same module instance. Keep
// equal-version DSH peers installation-owned even when a profile carries a
// second physical copy. Different versions and third-party peer graphs retain
// their normal resolution. Remove this adapter when the packaged DSH host owns
// canonical module resolution on Electron without its native Loader helper.
function createHostResolveHook(archive, configHome) {
  // Node returns real paths from resolution (notably /private/var on macOS),
  // while createRequire callers can retain the installation's original alias.
  const requestedArchive = archive;
  archive = fs.realpathSync(archive);
  const requireHost = createRequire(path.join(archive, 'package.json'));
  const profileAnchor = pathToFileURL(path.join(archive, 'profile/package.json')).href;
  const requireProfile = createRequire(profileAnchor);
  const configRoot = pathToFileURL(configHome + path.sep).href;
  const loaderEntry = pathToFileURL(requireHost.resolve('@deepseek-ai/cordis-plugin-loader')).href;
  const archiveRoot = pathToFileURL(archive + path.sep).href;
  const installParents = new Set([requestedArchive, archive].flatMap(root => [
    pathToFileURL(path.join(root, 'package.json')).href,
    pathToFileURL(root + path.sep).href,
  ]));
  const profilePeers = archiveRoot + 'profile/node_modules/@deepseek-ai/';
  const sharedPeers = new Map();

  // DSH's native internal-loader helper does not support Electron 44. Its
  // fallback imports from the Loader package; dynamic rows also import from
  // writable configuration directories. Resolve only misses at these two
  // application boundaries against the packaged profile, preserving normal
  // package resolution and import/require conditions everywhere else.
  // Remove when published DSH supports both paths in an embedded ASAR host.
  return {
    resolve(specifier, context, nextResolve) {
      let result;
      try {
        result = nextResolve(specifier, context);
      } catch (error) {
        const bare = !specifier.startsWith('.') && !specifier.startsWith('/') &&
          !specifier.startsWith('#') && !specifier.includes(':');
        if (!['ERR_MODULE_NOT_FOUND', 'MODULE_NOT_FOUND'].includes(error.code) || !bare ||
            !(context.parentURL?.startsWith(configRoot) || context.parentURL === loaderEntry ||
              installParents.has(context.parentURL))) throw error;
        // CJS nextResolve retains the original require's lookup paths even if
        // parentURL changes. Resolve through an actual profile require first.
        result = context.conditions.includes('require')
          ? nextResolve(requireProfile.resolve(specifier), context)
          : nextResolve(specifier, { ...context, parentURL: profileAnchor });
      }
      if (result.url.startsWith(profilePeers)) {
        const relative = result.url.slice(profilePeers.length);
        const name = relative.split('/')[0];
        if (!sharedPeers.has(name)) {
          const manifest = (root) => JSON.parse(fs.readFileSync(path.join(root, 'node_modules/@deepseek-ai', name, 'package.json'), 'utf8'));
          let shared = false;
          try { shared = manifest(archive).version === manifest(path.join(archive, 'profile')).version; }
          catch (error) { if (error.code !== 'ENOENT') throw error; }
          sharedPeers.set(name, shared);
        }
        if (sharedPeers.get(name)) result = { ...result, url: archiveRoot + 'node_modules/@deepseek-ai/' + relative };
      }
      // node-pty passes its helper path directly to native posix_spawn on macOS.
      // Loading the whole package from its physical unpacked location keeps
      // __dirname usable by the OS, which cannot traverse a virtual ASAR path.
      if (result.url.startsWith(archiveRoot) && result.url.includes('/node_modules/node-pty/')) {
        return { ...result, url: result.url.replace(archiveRoot, pathToFileURL(archive + '.unpacked' + path.sep).href) };
      }
      return result;
    },
  };
}

async function startDesktopHost(args) {
  const archive = path.join(__dirname, 'host.asar');
  const requireHost = createRequire(path.join(archive, 'package.json'));
  const installAnchor = pathToFileURL(path.join(archive, 'package.json')).href;
  const hooks = registerHooks(createHostResolveHook(archive, process.env.DSH_HOME));
  const load = (name) => import(pathToFileURL(requireHost.resolve(name)).href);
  const host = await load('@deepseek-ai/dsh-app-boot');
  const { provideCmdline } = await load('@deepseek-ai/dsh-cmdline');
  const { DSH_LAUNCH_ENVIRONMENT_KEY } = await load('@deepseek-ai/dsh-launch-environment');
  const profile = host.loadProfileDirectory('workspace-desktop', path.join(archive, 'profile'),
    requireHost.resolve('@deepseek-ai/dsh/package.json'));
  // Preset discovery uses the composition's filesystem base, not import hooks.
  // A fixed production composition therefore lives beside installed packages;
  // account storage, credentials, settings and user presets stay in DSH_HOME.
  const config = path.join(archive, 'desktop.cordis.yml');

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
    }, installAnchor);
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

module.exports = { startDesktopHost, createHostResolveHook };
