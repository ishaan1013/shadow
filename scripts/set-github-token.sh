#!/bin/bash

# Set GitHub token for container registry
# Usage: ./set-github-token.sh <username> <token>

if [ $# -ne 2 ]; then
    echo "Usage: $0 <username> <token>"
    exit 1
fi

kubectl delete secret ghcr-secret -n shadow-agents 2>/dev/null || true

kubectl create secret docker-registry ghcr-secret \
    --docker-server=ghcr.io \
    --docker-username="$1" \
    --docker-password="$2" \
    --namespace=shadow-agents

echo "✅ GitHub token set"