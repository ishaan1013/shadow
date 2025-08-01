#!/bin/bash

# Database helper script for production environment
# Sets the DATABASE_URL to production database and runs Prisma command

# Production database URL (from .env.production)
SCRIPT_DIR="$(dirname "$0")"
ROOT_DIR="$SCRIPT_DIR/.."

# Source the production environment file
if [ -f "$ROOT_DIR/.env.production" ]; then
    export $(grep -v '^#' "$ROOT_DIR/.env.production" | grep 'DATABASE_URL' | xargs)
else
    echo "Error: .env.production file not found"
    exit 1
fi

if [ -z "$DATABASE_URL" ]; then
    echo "Error: DATABASE_URL not found in .env.production"
    exit 1
fi

echo "Using production database: ${DATABASE_URL:0:30}..."

# Change to the db package directory
cd "$ROOT_DIR/packages/db" || exit 1

# Run the Prisma command passed as arguments
exec npx prisma "$@"