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
RUN pnpm --filter @univerjs/univer-workspace-mcp... build \
    && pnpm --filter @univerjs/univer-workspace-mcp deploy --legacy --prod --config.allow-unused-patches=true /app/deploy

FROM ${BASE_IMAGE} AS runtime
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
WORKDIR /app/univer-workspace-mcp
COPY --from=build /app/deploy ./
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
