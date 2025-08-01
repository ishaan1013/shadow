#!/bin/bash

# Database helper script for development environment
# Sets the DATABASE_URL to development database and runs Prisma command

# Development database URL
export DATABASE_URL="postgres://postgres:@127.0.0.1:5432/shadow_dev"

# Change to the db package directory
cd "$(dirname "$0")/../packages/db" || exit 1

# Run the Prisma command passed as arguments
exec npx prisma "$@"