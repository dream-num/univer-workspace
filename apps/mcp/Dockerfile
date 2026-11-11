ARG BASE_IMAGE=node:24-bookworm-slim
FROM ${BASE_IMAGE} AS build

ARG HTTP_PROXY=""
ARG PROXY_SSL=""
ARG NODE_MAX_OLD_SPACE_SIZE="4096"
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV NODE_EXTRA_CA_CERTS=${PROXY_SSL}
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY patches ./patches
COPY apps/mcp/package.json ./apps/mcp/package.json
COPY packages/client-core/package.json ./packages/client-core/package.json
RUN HTTP_PROXY="${HTTP_PROXY}" HTTPS_PROXY="${HTTP_PROXY}" pnpm install \
    --frozen-lockfile \
    --filter @univerjs/univer-workspace-mcp...
COPY tsconfig*.json ./
COPY apps/mcp ./apps/mcp
COPY packages/client-core ./packages/client-core
COPY apps/cli/skill-data ./apps/cli/skill-data
RUN NODE_OPTIONS="--max-old-space-size=${NODE_MAX_OLD_SPACE_SIZE}" pnpm --filter @univerjs/univer-workspace-mcp... build \
    && NODE_OPTIONS="--max-old-space-size=${NODE_MAX_OLD_SPACE_SIZE}" pnpm --filter @univerjs/univer-workspace-mcp \
      deploy --legacy --prod --config.allow-unused-patches=true /app/deploy

FROM ${BASE_IMAGE} AS runtime

ARG HTTP_PROXY=""
ENV NODE_ENV=production
ENV HOST=0.0.0.0
# The renderer role launches this Chromium. The Debian package is built for amd64 and arm64.
# The CJK and Latin fonts keep Chinese and Latin text from rendering as boxes.
# Behind a build proxy, use the Aliyun Debian mirror and keep apt off the proxy, so an
# HTTPS proxy does not need its CA trusted by the image.
RUN if [ -n "${HTTP_PROXY}" ]; then \
      for source in /etc/apt/sources.list /etc/apt/sources.list.d/*; do \
        [ -f "$source" ] || continue; \
        sed -i 's|deb.debian.org|mirrors.cloud.aliyuncs.com|g' "$source"; \
      done; \
      unset http_proxy https_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY all_proxy NO_PROXY no_proxy; \
    fi \
    && apt-get update \
    && apt-get install -y --no-install-recommends chromium fonts-noto-cjk fonts-liberation \
    && rm -rf /var/lib/apt/lists/*
ENV UNIVER_RENDER_BROWSER=/usr/bin/chromium
ENV PORT=3000
WORKDIR /app/univer-workspace-mcp
COPY --from=build /app/deploy ./
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
