# Sidecar Dockerfile - Following official Turborepo pattern
FROM node:22-alpine AS base

# Builder stage - prunes monorepo 
FROM base AS builder
RUN apk update && apk add --no-cache libc6-compat python3 make g++
WORKDIR /app
RUN npm install -g turbo@^2
COPY . .
# Generate a partial monorepo with a pruned lockfile for sidecar workspace
RUN turbo prune sidecar --docker

FROM base AS installer
RUN apk update && apk add --no-cache libc6-compat python3 make g++
WORKDIR /app

COPY --from=builder /app/out/json/ .
RUN npm ci

# Build the project
COPY --from=builder /app/out/full/ .

# Generate Prisma client first
RUN npm run generate --filter=@repo/db

# Build workspace dependencies and sidecar
RUN npx turbo build --filter=@repo/types --filter=@repo/command-security
WORKDIR /app/apps/sidecar
RUN npx tsc

# Runner stage - minimal runtime
FROM base AS runner
WORKDIR /app

RUN apk add --no-cache bash git openssh-client ripgrep findutils coreutils curl

# Create non-root user and workspace directory
RUN addgroup -g 1001 sidecar && adduser -D -u 1001 -G sidecar sidecar
RUN mkdir -p /workspace && chown -R sidecar:sidecar /workspace

USER sidecar

# Copy built application
COPY --from=installer --chown=sidecar:sidecar /app/apps/sidecar/dist ./apps/sidecar/dist
COPY --from=installer --chown=sidecar:sidecar /app/apps/sidecar/package.json ./apps/sidecar/package.json

# Copy necessary runtime files
COPY --from=installer --chown=sidecar:sidecar /app/node_modules ./node_modules
COPY --from=installer --chown=sidecar:sidecar /app/packages ./packages
COPY --from=installer --chown=sidecar:sidecar /app/package.json ./package.json

# Environment variables
ENV NODE_ENV=production
ENV PORT=8080
ENV WORKSPACE_DIR=/workspace

EXPOSE 8080

CMD ["node", "apps/sidecar/dist/server.js"]