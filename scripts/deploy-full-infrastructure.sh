#!/bin/bash

# Shadow Full Infrastructure Deployment Script
# Deploys both remote execution K8s cluster and ECS backend in sequence
#
# Usage:
#   ./deploy-full-infrastructure.sh
#
# Environment Variables:
#   All variables from both deploy-remote-infrastructure.sh and deploy-backend-ecs.sh
#   can be set to customize the deployment

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
NC='\033[0m' # No Color

log() {
    echo -e "${PURPLE}[FULL-DEPLOY]${NC} $1"
}

warn() {
    echo -e "${YELLOW}[FULL-DEPLOY]${NC} $1"
}

error() {
    echo -e "${RED}[FULL-DEPLOY]${NC} $1"
    exit 1
}

info() {
    echo -e "${BLUE}[FULL-DEPLOY]${NC} $1"
}

# Check that both deployment scripts exist
check_prerequisites() {
    log "Checking deployment scripts..."
    
    if [ ! -f "$SCRIPT_DIR/deploy-remote-infrastructure.sh" ]; then
        error "deploy-remote-infrastructure.sh not found in scripts directory"
    fi
    
    if [ ! -f "$SCRIPT_DIR/deploy-backend-ecs.sh" ]; then
        error "deploy-backend-ecs.sh not found in scripts directory"
    fi
    
    # Make sure scripts are executable
    chmod +x "$SCRIPT_DIR/deploy-remote-infrastructure.sh"
    chmod +x "$SCRIPT_DIR/deploy-backend-ecs.sh"
    
    log "Deployment scripts found and ready"
}

# Deploy remote execution infrastructure
deploy_remote() {
    log "🚀 Starting remote execution infrastructure deployment..."
    log "======================================================="
    
    # Run the remote infrastructure deployment script
    if "$SCRIPT_DIR/deploy-remote-infrastructure.sh"; then
        log "✅ Remote execution infrastructure deployment completed successfully"
    else
        error "❌ Remote execution infrastructure deployment failed"
    fi
    
    log "======================================================="
}

# Deploy ECS backend
deploy_ecs_backend() {
    log "🚀 Starting ECS backend deployment..."
    log "======================================================="
    
    # Run the ECS deployment script
    if "$SCRIPT_DIR/deploy-backend-ecs.sh"; then
        log "✅ ECS backend deployment completed successfully"
    else
        error "❌ ECS backend deployment failed"
    fi
    
    log "======================================================="
}

# Verify full deployment
verify_full_deployment() {
    log "🔍 Verifying full infrastructure deployment..."
    
    # Check remote execution cluster
    info "Checking remote execution cluster status..."
    if kubectl get nodes -l remote=true --no-headers 2>/dev/null | grep -q Ready; then
        log "✅ Remote execution cluster is running"
    else
        warn "⚠️  Could not verify remote execution cluster status"
    fi
    
    # Check ECS service
    info "Checking ECS service status..."
    ECS_CLUSTER_NAME="${ECS_CLUSTER_NAME:-shadow-ecs-cluster}"
    SERVICE_NAME="${SERVICE_NAME:-shadow-backend-service}"
    AWS_REGION="${AWS_REGION:-us-east-1}"
    
    if aws ecs describe-services \
        --cluster "$ECS_CLUSTER_NAME" \
        --services "$SERVICE_NAME" \
        --region "$AWS_REGION" \
        --profile ID \
        --query 'services[0].runningCount' \
        --output text 2>/dev/null | grep -q '^[1-9]'; then
        log "✅ ECS backend service is running"
    else
        warn "⚠️  Could not verify ECS service status"
    fi
    
    log "Full deployment verification completed"
}

# Print deployment summary
print_summary() {
    log "🎉 Shadow full infrastructure deployment completed!"
    log ""
    log "📋 Deployment Summary:"
    log "====================="
    log "✅ Remote execution K8s cluster deployed"
    log "✅ ECS backend service deployed"
    log ""
    log "🔧 Configuration Files Generated:"
    log "- .env.production (remote execution cluster access)"
    log ""
    log "📚 Next Steps:"
    log "1. Source the remote execution configuration:"
    log "   source .env.production"
    log ""
    log "2. Verify deployments:"
    log "   kubectl get nodes -l remote=true"
    log "   aws ecs describe-services --cluster ${ECS_CLUSTER_NAME:-shadow-ecs-cluster} --services ${SERVICE_NAME:-shadow-backend-service}"
    log ""
    log "3. Deploy your frontend application to use the ECS backend endpoint"
    log ""
    log "4. Test end-to-end functionality with a Shadow task"
    log ""
    log "🆘 Troubleshooting:"
    log "- Remote execution logs: kubectl logs -l app=shadow-remote -n shadow-agents"
    log "- ECS logs: aws logs tail /ecs/shadow-server --follow"
    log "- Check AWS Console for ECS service and ALB status"
}

# Main execution
main() {
    log "Starting Shadow full infrastructure deployment..."
    log "This will deploy both remote execution K8s cluster and ECS backend"
    log ""
    
    # Show configuration summary
    info "Configuration Summary:"
    info "- AWS Region: ${AWS_REGION:-us-east-1}"
    info "- Remote Execution Cluster: ${CLUSTER_NAME:-shadow-remote}"
    info "- ECS Cluster: ${ECS_CLUSTER_NAME:-shadow-ecs-cluster}"
    info "- VM Image: ${VM_IMAGE_REGISTRY:-ghcr.io/ishaan1013/shadow}/${VM_IMAGE_NAME:-shadow-vm}:${VM_IMAGE_TAG:-latest}"
    log ""
    
    # Prompt for confirmation
    read -p "Do you want to proceed with the deployment? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        log "Deployment cancelled by user"
        exit 0
    fi
    
    check_prerequisites
    deploy_remote
    deploy_ecs_backend
    verify_full_deployment
    print_summary
}

# Handle cleanup on exit
cleanup() {
    log "Full deployment script completed"
}

trap cleanup EXIT

# Run main function
main "$@"