# Lexy — self-contained Docker image
# Runs the gateway (port 18789) and portal (port 5174) together.
# Usage:
#   docker compose -f lexy/docker-compose.yml up --build
#   Open http://localhost:5174

# ---------------------------------------------------------------------------
# Stage 1: extract opt-in extension package.json files
# ---------------------------------------------------------------------------
ARG OPENCLAW_EXTENSIONS=""
FROM node:22-bookworm@sha256:cd7bcd2e7a1e6f72052feb023c7f6b722205d3fcab7bbcbd2d1bfdab10b1e935 AS ext-deps
ARG OPENCLAW_EXTENSIONS
COPY extensions /tmp/extensions
RUN mkdir -p /out && \
    for ext in $OPENCLAW_EXTENSIONS; do \
      if [ -f "/tmp/extensions/$ext/package.json" ]; then \
        mkdir -p "/out/$ext" && \
        cp "/tmp/extensions/$ext/package.json" "/out/$ext/package.json"; \
      fi; \
    done

# ---------------------------------------------------------------------------
# Stage 2: build gateway + portal
# ---------------------------------------------------------------------------
FROM node:22-bookworm@sha256:cd7bcd2e7a1e6f72052feb023c7f6b722205d3fcab7bbcbd2d1bfdab10b1e935 AS builder

RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:${PATH}"
RUN corepack enable

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY ui/package.json ./ui/package.json
COPY patches ./patches
COPY scripts ./scripts
COPY --from=ext-deps /out/ ./extensions/

RUN NODE_OPTIONS=--max-old-space-size=2048 pnpm install --frozen-lockfile

COPY . .

RUN for dir in /app/extensions /app/.agent /app/.agents; do \
      if [ -d "$dir" ]; then \
        find "$dir" -type d -exec chmod 755 {} +; \
        find "$dir" -type f -exec chmod 644 {} +; \
      fi; \
    done

RUN pnpm build
ENV OPENCLAW_PREFER_PNPM=1
RUN pnpm ui:build

# Build the Lexy portal (standalone Vite SPA, not a pnpm workspace member)
WORKDIR /app/lexy/portal
RUN npm ci || npm install
RUN npm run build

# ---------------------------------------------------------------------------
# Stage 3: slim runtime
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim

RUN npm install -g serve@latest && npm cache clean --force

WORKDIR /app
COPY --from=builder /app /app

RUN ln -sf /app/openclaw.mjs /usr/local/bin/openclaw \
 && chmod 755 /app/openclaw.mjs

COPY lexy/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Writable home + portal dist for the runtime user
RUN mkdir -p /home/node/.openclaw && chown -R node:node /home/node \
 && chown -R node:node /app/lexy/portal/dist

ENV NODE_ENV=production
ENV HOME=/home/node

EXPOSE 18789 5174

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:18789/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

USER node
ENTRYPOINT ["docker-entrypoint.sh"]
