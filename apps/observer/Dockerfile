# syntax=docker/dockerfile:1

FROM node:24-bookworm-slim AS build

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/observer/package.json ./apps/observer/package.json

RUN pnpm install \
    --frozen-lockfile \
    --filter @univerjs/univer-observer... \
    --filter .

COPY tsconfig.base.json ./
COPY apps/observer ./apps/observer

RUN pnpm --filter @univerjs/univer-observer build \
    && pnpm --filter @univerjs/univer-observer \
      deploy --legacy --prod /app/deploy

FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV OBSERVER_HOST=0.0.0.0
ENV OBSERVER_PORT=3030
ENV OBSERVER_DATABASE_FILE=/app/univer-observer/.data/univer-observer.sqlite
ENV WORKSPACE_DATABASE_FILE=/data/workspace/univer-workspace.sqlite
ENV COLLABORATION_DATABASE_FILE=/data/workspace/univer-collaboration.sqlite
ENV WORKSPACE_BLOB_DIRECTORY=/data/workspace/univer-workspace-blobs

WORKDIR /app/univer-observer

COPY --from=build /app/deploy/node_modules ./node_modules
COPY --from=build /app/deploy/package.json ./package.json
COPY --from=build /app/apps/observer/dist ./dist
COPY --from=build /app/apps/observer/generated ./generated

RUN mkdir -p /app/univer-observer/.data \
    && chown -R node:node /app/univer-observer

USER node

EXPOSE 3030
VOLUME ["/app/univer-observer/.data"]

CMD ["node", "dist/server/main.js"]
