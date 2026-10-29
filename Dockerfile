# ==========================================
# Stage 1: Build the TypeScript application
# ==========================================
FROM node:22-bookworm-slim AS builder

WORKDIR /app

# Install build dependencies
COPY package*.json tsconfig.json ./
RUN npm ci

# Copy source and build
COPY src/ ./src/
RUN npm run build

# ==========================================
# Stage 2: Hardened Runtime Environment
# ==========================================
FROM node:22-bookworm-slim AS runner

# Install Deno binary from official image for hardened subprocess sandboxing
COPY --from=denoland/deno:bin /deno /usr/local/bin/deno

WORKDIR /app

ENV NODE_ENV=production

# Install only production dependencies
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy compiled JavaScript from builder
COPY --from=builder /app/dist ./dist

# Copy starter config & docs
COPY codemode.config.json ./codemode.config.json

# Use non-root node user for container security
USER node

# Default stdio entrypoint for MCP clients
ENTRYPOINT ["node", "dist/cli.js"]
CMD ["--config", "codemode.config.json"]

