#!/bin/bash

# Shadow Server Build Script
# Compiles TypeScript and copies required assets

set -e  # Exit on any error

echo "🔨 Building Shadow Server..."

echo "🧹 Cleaning previous build..."
rm -rf dist

echo "📦 Compiling TypeScript..."
tsc

echo "🔗 Flattening build structure..."
# Move files from nested structure to flat structure for compatibility
if [ -d "dist/apps/server/src" ]; then
    # Clean up any existing temp directory first
    rm -rf dist_temp
    # Create a fresh temporary directory
    mkdir -p dist_temp
    # Move nested files to temp
    mv dist/apps/server/src/* dist_temp/
    # Remove the nested structure
    rm -rf dist/apps
    # Move files to the root of dist
    mv dist_temp/* dist/
    # Remove temp directory
    rm -rf dist_temp
fi

echo "🔗 Resolving path aliases..."
tsc-alias

echo "📄 Copying tool instruction files..."

mkdir -p dist/agent/tools/prompts

# Copy all markdown files from each tool directory
for tool_dir in src/agent/tools/prompts/*/; do
    if [ -d "$tool_dir" ]; then
        tool_name=$(basename "$tool_dir")
        echo "  📋 Copying $tool_name instructions..."
        
        # Create corresponding dist directory
        mkdir -p "dist/agent/tools/prompts/$tool_name"
        
        # Copy markdown files
        if ls "$tool_dir"*.md >/dev/null 2>&1; then
            cp "$tool_dir"*.md "dist/agent/tools/prompts/$tool_name/"
        fi
    fi
done

echo "✅ Server build complete!"