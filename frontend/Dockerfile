# syntax=docker/dockerfile:1

ARG NODE_IMAGE=node:26.13.0-alpine3.24@sha256:c6ad9e9c1d80f6eb607c26b4b0a132ff7a2344fad1c78ea3baa2a7d4c8de6d94
ARG NGINX_IMAGE=nginx:1.31.8-alpine3.24-slim@sha256:f45171d36c76a8b2f5ef97108a3a8a2294248a6578a0a180edc2d78f7d2edc26

FROM ${NODE_IMAGE} AS build
WORKDIR /app

# The local shared package must exist before npm resolves file:../shared.
COPY shared/ ./shared/
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

FROM ${NGINX_IMAGE} AS runtime
COPY frontend/nginx.conf /etc/nginx/nginx.conf
COPY --from=build /app/frontend/dist/ /app/public/

USER nginx
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD wget -q --spider http://127.0.0.1:8080/healthz || exit 1

# Run directly: the image's default entrypoint edits configuration files.
ENTRYPOINT []
CMD ["nginx", "-g", "daemon off;"]
