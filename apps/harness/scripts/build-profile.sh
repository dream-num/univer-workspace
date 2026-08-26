#!/usr/bin/env bash
#
# Build the Univer Workspace Harness profile with the official `dsh plugin`
# command so the profile's package.json and dsh.profile.bundles list are
# reconciled by the tool instead of being hand-written. DSH_HOME is isolated
# inside the image build; nothing here touches the profile manifest by hand.
#
# Required env:
#   DSH_HOME     image-isolated DeepSeek Harness home (e.g. /opt/dsh/home).
#   DSH_BIN      absolute path to the packaged dsh CLI lib/bin.js. The image
#                build installs the CLI into a bootstrap directory separate
#                from the workspace so the harness never depends on
#                @deepseek-ai/dsh at the workspace level (it would drag the dsh
#                client's react 18 tree into the Univer react 19 graph).
#
# Optional env:
#   DSH_PROFILE   profile name (default: univer-workspace-harness).
#   DSH_WEB_BUNDLE in-box web bundle that establishes the browser surface
#                 (default: the rc.2 bundle matching the current DSH CLI).
#   DSH_PLUGINS   space-separated out-of-tree bundle packages/specs (the
#                 harness core, capability, and skin bundle tarballs).
set -euo pipefail

: "${DSH_HOME:?DSH_HOME must be set to the image-isolated harness home}"
: "${DSH_BIN:?DSH_BIN must point at the packaged dsh CLI lib/bin.js}"
export DSH_HOME

PROFILE="${DSH_PROFILE:-univer-workspace-harness}"
WEB_BUNDLE="${DSH_WEB_BUNDLE:-@deepseek-ai/dsh-web-app@0.1.1-rc.2}"
INTERNAL_PLUGINS="${DSH_PLUGINS:-}"

dsh() {
  node "$DSH_BIN" "$@"
}

# The profile is a separate pnpm project. Review native install scripts before
# the first `dsh plugin add`; otherwise pnpm 11 refuses the native packages the
# web bundle pulls in. This file is profile package-manager policy, not a
# hand-written dsh package or bundle manifest.
PROFILE_DIR="$DSH_HOME/profiles/$PROFILE"
mkdir -p "$PROFILE_DIR"
cat >"$PROFILE_DIR/pnpm-workspace.yaml" <<'EOF'
allowBuilds:
  esbuild: true
  node-pty: true
  koffi: true
  node-addon-require-builtin: false
  protobufjs: false
  '@google/genai': false
supportedArchitectures:
  os:
    - current
  cpu:
    - current
  libc:
    - current
EOF

# Establish the browser surface. `dsh plugin` initializes the profile on first
# use, forwards to pnpm, and reconciles `dsh.profile.bundles` against the
# installed state, so the package and bundle manifests stay tool-owned.
dsh plugin --profile "$PROFILE" add "$WEB_BUNDLE"

# Add each out-of-tree bundle in its own invocation so the reconcile pass runs
# per bundle. The web bundle owns the profile's DSH package versions; disabling
# automatic peer installation makes the harness bundles reuse those versions.
if [ -n "$INTERNAL_PLUGINS" ]; then
  for pkg in $INTERNAL_PLUGINS; do
    dsh plugin --profile "$PROFILE" add --config.auto-install-peers=false "$pkg"
  done
fi

# Verify the composed tree (bundles + patch layers) without booting the process.
dsh --profile "$PROFILE" --dump-config >/dev/null

printf '[build-profile] profile %q ready at %s/profiles/%s\n' "$PROFILE" "$DSH_HOME" "$PROFILE"
