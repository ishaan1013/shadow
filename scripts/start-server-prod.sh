#!/bin/bash

# Shadow Production Start Script
# Builds the application and starts server in Firecracker production mode

set -e  # Exit on any error

echo "🚀 Starting Shadow in Production Mode (Local Development)..."


# Step 1: Build all packages
echo "🔨 Building all packages..."
npm run build

# Step 2: Load production environment variables
echo "📄 Loading production environment variables..."
set -a  # Enable automatic export of variables
source .env.production
set +a  # Disable automatic export

# Step 3: Start server in Remote mode (Local Development)
echo "🔥 Starting server in Remote mode (Local Development)..."
AGENT_MODE=firecracker NODE_ENV=production npm run --workspace=apps/server start