# ============================================================
# Stage 1: Build — compile frontend & prepare plugin
# ============================================================
FROM node:22-alpine AS build

RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

WORKDIR /build

# --- Plugin: install production dependencies ---
COPY plugins/qq-chat-exporter/package.json \
     plugins/qq-chat-exporter/package-lock.json \
     ./plugins/qq-chat-exporter/

WORKDIR /build/plugins/qq-chat-exporter
RUN npm ci --omit=dev

# --- Plugin: copy source (no create-overlay-runtime.cjs needed) ---
COPY plugins/qq-chat-exporter/index.mjs \
     plugins/qq-chat-exporter/package.json \
     ./
COPY plugins/qq-chat-exporter/lib ./lib

# --- Frontend: install all dependencies ---
WORKDIR /build/qce-v4-tool
COPY qce-v4-tool/package.json qce-v4-tool/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# --- Frontend: copy source & build ---
# next.config.mjs reads ../plugins/qq-chat-exporter/package.json for version
COPY qce-v4-tool/ .
ENV NODE_ENV=production
RUN pnpm run build

# ============================================================
# Stage 2: Runtime — NapCat + QCE plugin + static frontend
# ============================================================
FROM mlikiowa/napcat-docker:latest

# Copy plugin (source + production node_modules)
COPY --from=build /build/plugins/qq-chat-exporter /app/napcat/plugins/napcat-plugin-qce
RUN sed -i 's/"name": *"[^"]*"/"name": "napcat-plugin-qce"/' /app/napcat/plugins/napcat-plugin-qce/package.json

# Copy frontend static export
COPY --from=build /build/qce-v4-tool/out /app/napcat/static/qce-v4-tool

# ============================================================
# Create NapCatQQ stub module for plugin import resolution
# ============================================================
# The QCE plugin imports from 'NapCatQQ/src/core/index.js' and
# 'NapCatQQ/src/core/types.js'. These resolve to node_modules
# via Node.js module resolution. The stubs provide compatible
# classes/types so the plugin can load in the Docker environment.
RUN mkdir -p /app/napcat/node_modules/NapCatQQ/src/core
RUN mkdir -p /app/napcat/node_modules/NapCatQQ/src/onebot/api
COPY docker/napcat-stubs/package.json /app/napcat/node_modules/NapCatQQ/package.json
COPY docker/napcat-stubs/core-index.js /app/napcat/node_modules/NapCatQQ/src/core/index.js
COPY docker/napcat-stubs/core-types.js /app/napcat/node_modules/NapCatQQ/src/core/types.js
COPY docker/napcat-stubs/onebot-msg.js /app/napcat/node_modules/NapCatQQ/src/onebot/api/msg.js

# Copy custom entrypoint
COPY docker/docker-entrypoint-qce.sh /docker-entrypoint-qce.sh
RUN chmod +x /docker-entrypoint-qce.sh

EXPOSE 40653

ENTRYPOINT ["/docker-entrypoint-qce.sh"]
