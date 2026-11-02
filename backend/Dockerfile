# syntax=docker/dockerfile:1

ARG NODE_IMAGE=node:26.13.0-alpine3.24@sha256:c6ad9e9c1d80f6eb607c26b4b0a132ff7a2344fad1c78ea3baa2a7d4c8de6d94

FROM ${NODE_IMAGE} AS build
WORKDIR /app

# Keep the shared package in the same relative location as local development.
COPY shared/ ./shared/
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY backend/ ./
RUN npm run build:node

FROM ${NODE_IMAGE} AS runtime
# The server is a dependency-free bundle; package managers are build tools only.
RUN rm -rf /usr/local/lib/node_modules /opt/yarn-v* \
    /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/yarn \
    /usr/local/bin/yarnpkg /usr/local/bin/corepack
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000
WORKDIR /app
COPY --from=build --chown=node:node /app/backend/dist/server.mjs ./dist/server.mjs

USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD ["node", "--input-type=module", "-e", "const response = await fetch('http://127.0.0.1:3000/healthz', { signal: AbortSignal.timeout(3000) }); if (!response.ok) process.exit(1);"]

CMD ["node", "dist/server.mjs"]
