# Backend Server Dockerfile - Optimized for Turborepo monorepo
FROM node:20-alpine AS base

# Builder stage - prunes monorepo and installs dependencies
FROM base AS builder
RUN apk update && apk add --no-cache libc6-compat python3 make g++
WORKDIR /app

# Install turbo globally
RUN npm install -g turbo@^2

# Copy entire monorepo for pruning
COPY . .

# Generate a partial monorepo with pruned lockfile for server workspace
RUN turbo prune server --docker

# Installer stage - installs dependencies from pruned workspace
FROM base AS installer  
RUN apk update && apk add --no-cache libc6-compat python3 make g++
WORKDIR /app

# Copy lockfile and package.json files from pruned workspace
COPY --from=builder /app/out/json/ .
RUN npm install

# Copy source files and build
COPY --from=builder /app/out/full/ .
# Generate Prisma client first
RUN npm run generate --filter=@repo/db
# Build the server with Docker-specific config
WORKDIR /app/apps/server
RUN npx tsc

# Runtime stage - minimal production image
FROM base AS runner
WORKDIR /app

# Install runtime dependencies
RUN apk add --no-cache \
  bash \
  git \
  openssh-client \
  curl \
  && rm -rf /var/cache/apk/*

# Create non-root user
RUN addgroup -g 1001 server && \
  adduser -D -u 1001 -G server server

# Copy built application and dependencies
COPY --from=installer --chown=server:server /app/apps/server/dist ./apps/server/dist
COPY --from=installer --chown=server:server /app/apps/server/package.json ./apps/server/package.json
COPY --from=installer --chown=server:server /app/node_modules ./node_modules
COPY --from=installer --chown=server:server /app/packages ./packages

# Switch to non-root user
USER server

# Environment variables
ENV NODE_ENV=production
ENV PORT=4000

# Expose port
EXPOSE 4000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:4000/health || exit 1

# Start the server
CMD ["node", "apps/server/dist/server.js"]