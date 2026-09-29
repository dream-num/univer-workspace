# syntax=docker/dockerfile:1

ARG BASE_IMAGE=node:24-bookworm-slim
ARG HTTP_PROXY=""
ARG PROXY_SSL=""
ARG NODE_MAX_OLD_SPACE_SIZE="4096"

FROM ${BASE_IMAGE} AS build

ARG VITE_UNIVER_LICENSE
ENV VITE_UNIVER_LICENSE=$VITE_UNIVER_LICENSE
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV NODE_EXTRA_CA_CERTS=${PROXY_SSL}

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
# pnpm reads every configured patch before applying workspace filters.
COPY patches ./patches
COPY apps/workspace/package.json ./apps/workspace/package.json
COPY packages/reference-provider/package.json ./packages/reference-provider/package.json
COPY packages/unit-comparison-viewer/package.json ./packages/unit-comparison-viewer/package.json
COPY packages/workspace-file-browser/package.json ./packages/workspace-file-browser/package.json
COPY packages/workspace-ui/package.json ./packages/workspace-ui/package.json
COPY packages/workspace-html-viewer/package.json ./packages/workspace-html-viewer/package.json
COPY packages/workspace-markdown-viewer/package.json ./packages/workspace-markdown-viewer/package.json

RUN HTTP_PROXY="${HTTP_PROXY}" HTTPS_PROXY="${HTTP_PROXY}" pnpm install \
    --frozen-lockfile \
    --filter @univerjs/univer-workspace... \
    --filter .

COPY tsconfig.base.json ./
COPY apps/workspace ./apps/workspace
COPY packages/reference-provider ./packages/reference-provider
COPY packages/unit-comparison-viewer ./packages/unit-comparison-viewer
COPY packages/workspace-file-browser ./packages/workspace-file-browser
COPY packages/workspace-ui ./packages/workspace-ui
COPY packages/workspace-html-viewer ./packages/workspace-html-viewer
COPY packages/workspace-markdown-viewer ./packages/workspace-markdown-viewer

# The production Workspace graph excludes the desktop-only signing package.
RUN NODE_OPTIONS="--max-old-space-size=${NODE_MAX_OLD_SPACE_SIZE}" pnpm --filter @univerjs/univer-workspace-reference-provider build \
    && NODE_OPTIONS="--max-old-space-size=${NODE_MAX_OLD_SPACE_SIZE}" pnpm --filter @univerjs/univer-workspace build \
    && NODE_OPTIONS="--max-old-space-size=${NODE_MAX_OLD_SPACE_SIZE}" pnpm --filter @univerjs/univer-workspace \
      deploy --legacy --prod --config.allow-unused-patches=true /app/deploy

FROM ${BASE_IMAGE} AS runtime

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3020

WORKDIR /app/univer-workspace

COPY --from=build /app/deploy/node_modules ./node_modules
COPY --from=build /app/deploy/package.json ./package.json
COPY --from=build /app/apps/workspace/dist ./dist
COPY --from=build /app/apps/workspace/generated ./generated

RUN mkdir -p /app/univer-workspace/.data \
    && chown -R node:node /app/univer-workspace

USER node

EXPOSE 3020
VOLUME ["/app/univer-workspace/.data"]

CMD ["node", "dist/server/main.js"]
