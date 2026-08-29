# syntax=docker/dockerfile:1

FROM node:24-bookworm-slim AS build

ARG VITE_UNIVER_LICENSE
ENV VITE_UNIVER_LICENSE=$VITE_UNIVER_LICENSE
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY patches ./patches
COPY apps/workspace/package.json ./apps/workspace/package.json
COPY packages/reference-provider/package.json ./packages/reference-provider/package.json

RUN pnpm install \
    --frozen-lockfile \
    --filter @univerjs/univer-workspace... \
    --filter .

COPY tsconfig.base.json ./
COPY apps/workspace ./apps/workspace
COPY packages/reference-provider ./packages/reference-provider

RUN pnpm --filter @univerjs/univer-workspace-reference-provider build \
    && pnpm --filter @univerjs/univer-workspace build \
    && pnpm --filter @univerjs/univer-workspace \
      deploy --legacy --prod /app/deploy

FROM node:24-bookworm-slim AS runtime

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
