#!/bin/bash

# Quick VM Image Deployment Test Script
# Tests if the VM image can be pulled and deployed to cluster nodes

set -euo pipefail

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() { echo -e "${GREEN}[TEST]${NC} $1"; }
error() { echo -e "${RED}[TEST]${NC} $1"; }
warn() { echo -e "${YELLOW}[TEST]${NC} $1"; }

# Configuration
IMAGE_NAME="ghcr.io/ishaan1013/shadow/shadow-vm:latest"
NAMESPACE="shadow-agents"

log "Testing VM image deployment..."
log "Image: $IMAGE_NAME"
log "Namespace: $NAMESPACE"

# Test 1: Check if image exists locally
log "🔍 Test 1: Checking if image exists locally..."
log "Pulling $IMAGE_NAME (this may take a few minutes for large images)..."

# Try to pull with progress shown
if docker pull "$IMAGE_NAME"; then
    log "✅ Image pulled successfully from registry"
    
    # Show image size
    IMAGE_SIZE=$(docker images "$IMAGE_NAME" --format "table {{.Size}}" | tail -n 1)
    log "📦 Image size: $IMAGE_SIZE"
else
    error "❌ Failed to pull image"
    error ""
    error "Possible causes:"
    error "1. Authentication required - try: docker login ghcr.io -u ishaan1013"
    error "2. Image doesn't exist - check if GitHub Action finished building"
    error "3. Network issues - check internet connection"
    error ""
    error "Let's check if you're logged in to GitHub Container Registry:"
    
    # Test if already logged in
    if docker pull ghcr.io/library/hello-world:latest >/dev/null 2>&1; then
        log "✅ You are logged in to GHCR"
        error "The image probably doesn't exist yet - check GitHub Actions"
    else
        error "❌ You are not logged in to GHCR"
        error "Run: docker login ghcr.io -u ishaan1013"
        error "Token: Use your GitHub Personal Access Token"
    fi
    exit 1
fi

# Test 2: Check cluster connectivity
log "🔍 Test 2: Checking cluster connectivity..."
if kubectl get nodes > /dev/null 2>&1; then
    log "✅ Kubernetes cluster accessible"
else
    error "❌ Cannot connect to Kubernetes cluster"
    exit 1
fi

# Test 3: Check if firecracker nodes exist
log "🔍 Test 3: Checking for Firecracker nodes..."
FIRECRACKER_NODES=$(kubectl get nodes -l firecracker=true --no-headers | wc -l)
if [ "$FIRECRACKER_NODES" -gt 0 ]; then
    log "✅ Found $FIRECRACKER_NODES Firecracker nodes"
    kubectl get nodes -l firecracker=true
else
    error "❌ No Firecracker nodes found"
    exit 1
fi

# Test 4: Check if namespace exists
log "🔍 Test 4: Checking namespace..."
if kubectl get namespace "$NAMESPACE" > /dev/null 2>&1; then
    log "✅ Namespace $NAMESPACE exists"
else
    error "❌ Namespace $NAMESPACE not found"
    exit 1
fi

# Test 5: Simple image pull test on cluster
log "🔍 Test 5: Testing image pull on cluster nodes..."
kubectl apply -f - << EOF
apiVersion: v1
kind: Pod
metadata:
  name: vm-image-test
  namespace: $NAMESPACE
spec:
  nodeSelector:
    firecracker: "true"
  tolerations:
  - key: firecracker.shadow.ai/dedicated
    operator: Equal
    value: "true"
    effect: NoSchedule
  containers:
  - name: test
    image: $IMAGE_NAME
    imagePullPolicy: Always
    command: ["/bin/sh"]
    args: ["-c", "echo 'Image pull successful' && ls -la /var/lib/firecracker/ && sleep 30"]
  restartPolicy: Never
EOF

log "⏳ Waiting for test pod to start..."
sleep 5

# Check pod status
POD_STATUS=$(kubectl get pod vm-image-test -n "$NAMESPACE" -o jsonpath='{.status.phase}' 2>/dev/null || echo "NotFound")
log "Pod status: $POD_STATUS"

if [ "$POD_STATUS" = "Running" ] || [ "$POD_STATUS" = "Succeeded" ]; then
    log "✅ Test pod started successfully!"
    log "📋 Pod logs:"
    kubectl logs vm-image-test -n "$NAMESPACE" || true
else
    warn "⚠️  Test pod not running yet. Checking details..."
    kubectl describe pod vm-image-test -n "$NAMESPACE"
    
    log "📋 Pod events:"
    kubectl get events -n "$NAMESPACE" --field-selector involvedObject.name=vm-image-test --sort-by='.lastTimestamp' || true
fi

# Cleanup
log "🧹 Cleaning up test pod..."
kubectl delete pod vm-image-test -n "$NAMESPACE" --ignore-not-found=true

# Test 6: Check what's in the VM image
log "🔍 Test 6: Inspecting VM image contents..."
log "Expected files in image:"
docker run --rm "$IMAGE_NAME" ls -la /var/lib/firecracker/ 2>/dev/null || {
    error "❌ Cannot inspect image contents"
    exit 1
}

log "📁 VM image structure:"
docker run --rm "$IMAGE_NAME" find /var/lib/firecracker -type f 2>/dev/null || true

log ""
log "🎯 Test Summary:"
log "If all tests passed, the VM deployment should work."
log "If tests failed, check the error messages above."
log ""
log "To retry the full deployment:"
log "  ./scripts/deploy-firecracker-infrastructure.sh"