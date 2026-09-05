# syntax=docker/dockerfile:1

# Univer Workspace Harness image. The chart runs one DSH web container whose
# profile bundles the harness core and the two Univer plugins. DSH_HOME and
# the profile are isolated inside the image; runtime working files live on a
# bounded emptyDir mounted at /workspace by the chart.

# ── Build ───────────────────────────────────────────────────────────────────
FROM node:24-bookworm-slim AS build

# Registry used to resolve the exact @deepseek-ai/* versions and the Univer
# SDK baseline. The insider proxy is anonymous in the staging cluster; the
# optional BuildKit npm_token secret supports installations that require
# authentication.
ARG NPM_REGISTRY=https://insider-npm-registry.univer.work/
ENV COREPACK_NPM_REGISTRY=https://registry.npmjs.org

WORKDIR /src

# Copy manifests first so the pnpm store/lockfile layer caches across rebuilds.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
COPY scripts ./scripts

RUN --mount=type=secret,id=npm_token \
    if [ -s /run/secrets/npm_token ]; then \
      printf 'registry=%s\n//%s:_authToken=%s\n' \
        "$NPM_REGISTRY" \
        "$(printf '%s' "$NPM_REGISTRY" | sed -E 's#^[a-z]+://##; s#/$##')" \
        "$(cat /run/secrets/npm_token)" > .npmrc; \
    else \
      printf 'registry=%s\n' "$NPM_REGISTRY" > .npmrc; \
    fi

RUN corepack enable && corepack install --global pnpm@11.24.0 && pnpm install --frozen-lockfile

# Build every shipped face before packing the local bundles into the profile.
RUN pnpm -r --if-present build

# Pack the three harness bundles into the image profile directory.
RUN mkdir -p /opt/dsh/home/internal-packages \
  && pnpm --filter @univerjs/univer-workspace-harness pack --pack-destination /opt/dsh/home/internal-packages \
  && pnpm --filter dsh-univer-workspace-plugin pack --pack-destination /opt/dsh/home/internal-packages \
  && pnpm --filter dsh-univer-workspace-skin-plugin pack --pack-destination /opt/dsh/home/internal-packages

# Install the dsh CLI into a bootstrap directory separate from the workspace so
# the harness never depends on @deepseek-ai/dsh at the workspace level (that
# would drag the dsh client's react 18 tree into the Univer react 19 graph).
RUN mkdir -p /opt/dsh/bootstrap && cd /opt/dsh/bootstrap \
  && printf 'registry=%s\n' "$NPM_REGISTRY" > .npmrc \
  && corepack pnpm add --prefer-offline \
      --allow-build=@deepseek-ai/dsh-subprocess-local \
      --allow-build=@google/genai \
      --allow-build=koffi \
      --allow-build=node-pty \
      --allow-build=protobufjs \
      @deepseek-ai/dsh@0.1.2-alpha.4

# Build the profile through the official `dsh plugin` command so the profile's
# package.json and dsh.profile.bundles list are reconciled by the tool — never
# hand-written. DSH_HOME is isolated inside the image.
ENV DSH_HOME=/opt/dsh/home \
    DSH_BIN=/opt/dsh/bootstrap/node_modules/@deepseek-ai/dsh/lib/bin.js \
    DSH_WEB_BUNDLE="@deepseek-ai/dsh-web-app@0.1.2-alpha.4" \
    DSH_PLUGINS="file:/opt/dsh/home/internal-packages/univerjs-univer-workspace-harness-0.1.0.tgz file:/opt/dsh/home/internal-packages/dsh-univer-workspace-plugin-0.1.0.tgz file:/opt/dsh/home/internal-packages/dsh-univer-workspace-skin-plugin-0.1.0.tgz"
RUN NPM_CONFIG_USERCONFIG=/src/.npmrc ./apps/harness/scripts/build-profile.sh
RUN printf 'registry=%s\n' "$NPM_REGISTRY" > /opt/dsh/home/profiles/univer-workspace-harness/.npmrc

# ── Runtime ─────────────────────────────────────────────────────────────────
FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production \
    DSH_HOME=/opt/dsh/home \
    DSH_BIN=/opt/dsh/install/node_modules/@deepseek-ai/dsh/lib/bin.js \
    UWH_DSH_DATA_HOME=/workspace/.dsh \
    HOME=/home/dsh \
    UWH_RENDER_PAGE_ROOT=/opt/univer/render-runtime \
    UWH_RENDER_BROWSER=/usr/local/bin/google-chrome \
    AGENT_BROWSER_EXECUTABLE_PATH=/usr/local/bin/google-chrome

# The render SDK needs a real browser. Install it once while building the
# image; runtime operations only use the resulting executable and page.
RUN apt-get update \
  && apt-get install -y --no-install-recommends sudo \
  && rm -rf /var/lib/apt/lists/*

RUN npm install --global --allow-scripts=agent-browser agent-browser@0.31.2 \
  && mkdir -p /opt/agent-browser \
  && HOME=/opt/agent-browser agent-browser install --with-deps \
  && chrome_path="$(find /opt/agent-browser/.agent-browser/browsers -type f -name chrome -print -quit)" \
  && test -n "${chrome_path}" \
  && test -x "${chrome_path}" \
  && ln -s "${chrome_path}" "${AGENT_BROWSER_EXECUTABLE_PATH}" \
  && "${AGENT_BROWSER_EXECUTABLE_PATH}" --version \
  && HOME=/opt/agent-browser agent-browser doctor --offline --quick \
  && npm uninstall --global agent-browser \
  && npm cache clean --force

RUN if ! getent passwd 1000 >/dev/null; then \
      useradd -r -u 1000 -d /home/dsh -m -s /usr/sbin/nologin dsh; \
    fi \
  && mkdir -p /opt/dsh/install /opt/dsh/home /workspace /home/dsh \
  && chown -R 1000:1000 /opt/dsh /workspace /home/dsh

# The DSH installation (install anchor) and DSH_HOME profile tree. The build
# .npmrc (with its token) is deliberately left in the build stage and not copied,
# so no registry credential reaches runtime.
COPY --from=build --chown=1000:1000 /opt/dsh/bootstrap/node_modules /opt/dsh/install/node_modules
COPY --from=build --chown=1000:1000 /opt/dsh/home /opt/dsh/home
COPY --from=build --chown=1000:1000 /src/apps/harness/scripts/start-local.mjs /opt/dsh/start-local.mjs
COPY --from=build --chown=1000:1000 /src/packages/client-core/dist/render-runtime /opt/univer/render-runtime

# Fail the image build instead of shipping a harness whose screenshot tools
# can only fail at first use.
RUN test -s "${UWH_RENDER_PAGE_ROOT}/index.html" \
  && test -d "${UWH_RENDER_PAGE_ROOT}/assets" \
  && test -x "${UWH_RENDER_BROWSER}"

# Launcher for the packaged dsh CLI.
RUN printf '#!/bin/sh\nexec node /opt/dsh/install/node_modules/@deepseek-ai/dsh/lib/bin.js "$@"\n' \
    > /usr/local/bin/dsh \
  && printf '#!/bin/sh\nset -eu\ntrusted_host="${UWH_PUBLIC_HOST:-127.0.0.1}"\nexec node /opt/dsh/start-local.mjs --port "${UWH_PORT:-3080}" --no-open --trusted-host "$trusted_host"\n' \
    > /usr/local/bin/univer-workspace-harness-entrypoint \
  && chmod 0755 /usr/local/bin/dsh /usr/local/bin/univer-workspace-harness-entrypoint

WORKDIR /workspace

USER 1000:1000

EXPOSE 3080

CMD ["/usr/local/bin/univer-workspace-harness-entrypoint"]
