ARG BASE_IMAGE=node:24-bookworm-slim
FROM ${BASE_IMAGE} AS build
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY patches ./patches
COPY apps/mcp/package.json ./apps/mcp/package.json
COPY packages/client-core/package.json ./packages/client-core/package.json
RUN pnpm install --frozen-lockfile --filter @univerjs/univer-workspace-mcp...
COPY tsconfig*.json ./
COPY apps/mcp ./apps/mcp
COPY packages/client-core ./packages/client-core
COPY apps/cli/skill-data ./apps/cli/skill-data
RUN pnpm --filter @univerjs/univer-workspace-mcp... build \
    && pnpm --filter @univerjs/univer-workspace-mcp deploy --legacy --prod --config.allow-unused-patches=true /app/deploy

FROM ${BASE_IMAGE} AS runtime
ENV NODE_ENV=production
ENV HOST=0.0.0.0
# The renderer role launches this Chromium. The Debian package is built for amd64 and arm64.
# The CJK and Latin fonts keep Chinese and Latin text from rendering as boxes.
RUN apt-get update \
    && apt-get install -y --no-install-recommends chromium fonts-noto-cjk fonts-liberation \
    && rm -rf /var/lib/apt/lists/*
ENV UNIVER_RENDER_BROWSER=/usr/bin/chromium
ENV PORT=3000
WORKDIR /app/univer-workspace-mcp
COPY --from=build /app/deploy ./
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
