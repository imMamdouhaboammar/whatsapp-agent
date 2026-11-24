# Multi-stage production Dockerfile for fable-agentic-whatsapp
# Optimized for low-spec VPS environments (1-2 GB RAM, 1-2 vCPU)
# WA-021: bun images match package.json engines (bun >=1.3.0); installs are
# frozen against the committed lockfiles with no unlocked fallback.

# --- Stage 1: Build Web Cockpit UI ---
FROM oven/bun:1.4 AS ui-builder
WORKDIR /app/ui

COPY ui/package.json ui/bun.lock ./
RUN bun install --frozen-lockfile

COPY ui/ ./
RUN bun run build

# --- Stage 2: Production Runtime ---
FROM oven/bun:1.4-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000

# Install dependencies strictly from the committed lockfile.
COPY package.json bun.lock patch-baileys.mjs ./
RUN bun install --production --frozen-lockfile
# Verify the Baileys compatibility patch explicitly (idempotent, fails loudly).
RUN bun patch-baileys.mjs

# Copy source code and prebuilt UI distribution
COPY src/ ./src/
COPY --from=ui-builder /app/ui/dist ./ui/dist

# Ensure data directory exists with write permissions and assign ownership to bun user
RUN mkdir -p /app/data && chown -R bun:bun /app

VOLUME ["/app/data"]

EXPOSE 3000

# Hermetic healthcheck using Bun's native fetch
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD bun -e "fetch('http://127.0.0.1:3000/healthz').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

USER bun

CMD ["bun", "run", "src/index.ts"]
