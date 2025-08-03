#!/bin/bash

# Shadow Infrastructure Cleanup Script
# Forcefully removes all Shadow-related AWS resources
#
# Usage: ./cleanup-infrastructure.sh [cluster-name]
# Default cluster name: shadow-remote

set -euo pipefail

CLUSTER_NAME="${1:-shadow-remote}"
AWS_REGION="${AWS_REGION:-us-east-1}"
AWS_PROFILE="${AWS_PROFILE:-ID}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log() { echo -e "${GREEN}[CLEANUP]${NC} $1"; }
warn() { echo -e "${YELLOW}[CLEANUP]${NC} $1"; }
error() { echo -e "${RED}[CLEANUP]${NC} $1"; }
info() { echo -e "${BLUE}[CLEANUP]${NC} $1"; }

# Step 1: Delete EKS cluster (this should handle most resources)
cleanup_eks_cluster() {
    log "Step 1: Attempting to delete EKS cluster via eksctl..."
    
    if eksctl delete cluster --name "$CLUSTER_NAME" --region "$AWS_REGION" --profile "$AWS_PROFILE" --wait; then
        log "✅ EKS cluster deleted successfully via eksctl"
        return 0
    else
        warn "❌ eksctl deletion failed, proceeding with manual cleanup..."
        return 1
    fi
}

# Step 2: Force delete all related CloudFormation stacks
cleanup_cloudformation_stacks() {
    log "Step 2: Force deleting all related CloudFormation stacks..."
    
    # Get all stacks related to this cluster
    STACKS=$(aws cloudformation list-stacks \
        --region "$AWS_REGION" \
        --profile "$AWS_PROFILE" \
        --query "StackSummaries[?contains(StackName, \`$CLUSTER_NAME\`) && StackStatus != \`DELETE_COMPLETE\`].StackName" \
        --output text)
    
    if [ -z "$STACKS" ]; then
        log "No CloudFormation stacks found to delete"
        return 0
    fi
    
    # Delete stacks in reverse dependency order
    for STACK in $STACKS; do
        log "Deleting stack: $STACK"
        aws cloudformation delete-stack \
            --stack-name "$STACK" \
            --region "$AWS_REGION" \
            --profile "$AWS_PROFILE" || true
    done
    
    # Wait for deletions
    log "Waiting for stack deletions to complete..."
    for STACK in $STACKS; do
        aws cloudformation wait stack-delete-complete \
            --stack-name "$STACK" \
            --region "$AWS_REGION" \
            --profile "$AWS_PROFILE" || warn "Stack $STACK deletion timed out"
    done
}

# Step 3: Clean up orphaned VPCs
cleanup_vpcs() {
    log "Step 3: Cleaning up orphaned VPCs..."
    
    # Find VPCs with eksctl tags
    VPC_IDS=$(aws ec2 describe-vpcs \
        --region "$AWS_REGION" \
        --profile "$AWS_PROFILE" \
        --filters "Name=tag:eksctl.cluster.k8s.io/v1alpha1/cluster-name,Values=$CLUSTER_NAME" \
        --query 'Vpcs[].VpcId' \
        --output text 2>/dev/null || echo "")
    
    for VPC_ID in $VPC_IDS; do
        if [ -n "$VPC_ID" ]; then
            log "Found orphaned VPC: $VPC_ID"
            
            # Delete all resources in VPC first
            cleanup_vpc_resources "$VPC_ID"
            
            # Delete the VPC
            log "Deleting VPC: $VPC_ID"
            aws ec2 delete-vpc --vpc-id "$VPC_ID" --region "$AWS_REGION" --profile "$AWS_PROFILE" || warn "Failed to delete VPC $VPC_ID"
        fi
    done
}

# Helper: Clean up all resources in a VPC
cleanup_vpc_resources() {
    local VPC_ID="$1"
    log "Cleaning up resources in VPC: $VPC_ID"
    
    # Delete NAT Gateways
    aws ec2 describe-nat-gateways \
        --region "$AWS_REGION" \
        --profile "$AWS_PROFILE" \
        --filter "Name=vpc-id,Values=$VPC_ID" \
        --query 'NatGateways[].NatGatewayId' \
        --output text | xargs -r -n1 aws ec2 delete-nat-gateway --region "$AWS_REGION" --profile "$AWS_PROFILE" --nat-gateway-id || true
    
    # Delete Internet Gateways
    aws ec2 describe-internet-gateways \
        --region "$AWS_REGION" \
        --profile "$AWS_PROFILE" \
        --filters "Name=attachment.vpc-id,Values=$VPC_ID" \
        --query 'InternetGateways[].InternetGatewayId' \
        --output text | xargs -r -n1 -I {} bash -c 'aws ec2 detach-internet-gateway --internet-gateway-id {} --vpc-id '"$VPC_ID"' --region '"$AWS_REGION"' --profile '"$AWS_PROFILE"' && aws ec2 delete-internet-gateway --internet-gateway-id {} --region '"$AWS_REGION"' --profile '"$AWS_PROFILE"'' || true
    
    # Delete Security Groups (except default)
    aws ec2 describe-security-groups \
        --region "$AWS_REGION" \
        --profile "$AWS_PROFILE" \
        --filters "Name=vpc-id,Values=$VPC_ID" \
        --query 'SecurityGroups[?GroupName != `default`].GroupId' \
        --output text | xargs -r -n1 aws ec2 delete-security-group --region "$AWS_REGION" --profile "$AWS_PROFILE" --group-id || true
    
    # Delete Subnets
    aws ec2 describe-subnets \
        --region "$AWS_REGION" \
        --profile "$AWS_PROFILE" \
        --filters "Name=vpc-id,Values=$VPC_ID" \
        --query 'Subnets[].SubnetId' \
        --output text | xargs -r -n1 aws ec2 delete-subnet --region "$AWS_REGION" --profile "$AWS_PROFILE" --subnet-id || true
    
    # Delete Route Tables (except main)
    aws ec2 describe-route-tables \
        --region "$AWS_REGION" \
        --profile "$AWS_PROFILE" \
        --filters "Name=vpc-id,Values=$VPC_ID" \
        --query 'RouteTables[?Associations[0].Main != `true`].RouteTableId' \
        --output text | xargs -r -n1 aws ec2 delete-route-table --region "$AWS_REGION" --profile "$AWS_PROFILE" --route-table-id || true
}

# Step 4: Clean up Kubernetes resources
cleanup_kubernetes_resources() {
    log "Step 4: Cleaning up Kubernetes resources..."
    
    # Check if kubectl is available and cluster is accessible
    if ! command -v kubectl &> /dev/null; then
        warn "kubectl not found, skipping Kubernetes cleanup"
        return 0
    fi
    
    # Update kubeconfig to ensure access
    aws eks update-kubeconfig --region "$AWS_REGION" --name "$CLUSTER_NAME" --profile "$AWS_PROFILE" 2>/dev/null || true
    
    # Clean up Kata Containers resources
    log "Cleaning up Kata Containers resources..."
    kubectl delete daemonset kata-deploy -n kube-system --ignore-not-found=true || true
    kubectl delete -f https://raw.githubusercontent.com/kata-containers/kata-containers/main/tools/packaging/kata-deploy/kata-deploy/base/kata-deploy.yaml --ignore-not-found=true || true
    kubectl delete -f https://raw.githubusercontent.com/kata-containers/kata-containers/main/tools/packaging/kata-deploy/kata-rbac/base/kata-rbac.yaml --ignore-not-found=true || true
    
    # Clean up RuntimeClasses
    kubectl delete runtimeclass kata-qemu kata-fc --ignore-not-found=true || true
    
    # Clean up Shadow namespace and resources
    log "Cleaning up Shadow namespace and resources..."
    kubectl delete namespace shadow-agents --ignore-not-found=true || true
    
    log "Kubernetes resources cleaned up"
}

# Step 5: Clean up ECS resources (if they exist)
cleanup_ecs_resources() {
    log "Step 5: Cleaning up ECS resources..."
    
    ECS_CLUSTER_NAME="shadow-ecs-cluster"
    SERVICE_NAME="shadow-backend-service"
    
    # Stop ECS service
    if aws ecs describe-services --cluster "$ECS_CLUSTER_NAME" --services "$SERVICE_NAME" --region "$AWS_REGION" --profile "$AWS_PROFILE" &>/dev/null; then
        log "Stopping ECS service: $SERVICE_NAME"
        aws ecs update-service --cluster "$ECS_CLUSTER_NAME" --service "$SERVICE_NAME" --desired-count 0 --region "$AWS_REGION" --profile "$AWS_PROFILE" || true
        aws ecs delete-service --cluster "$ECS_CLUSTER_NAME" --service "$SERVICE_NAME" --region "$AWS_REGION" --profile "$AWS_PROFILE" || true
    fi
    
    # Delete ECS cluster
    if aws ecs describe-clusters --clusters "$ECS_CLUSTER_NAME" --region "$AWS_REGION" --profile "$AWS_PROFILE" &>/dev/null; then
        log "Deleting ECS cluster: $ECS_CLUSTER_NAME"
        aws ecs delete-cluster --cluster "$ECS_CLUSTER_NAME" --region "$AWS_REGION" --profile "$AWS_PROFILE" || true
    fi
    
    # Delete ALB
    ALB_ARN=$(aws elbv2 describe-load-balancers --names shadow-alb --region "$AWS_REGION" --profile "$AWS_PROFILE" --query 'LoadBalancers[0].LoadBalancerArn' --output text 2>/dev/null || echo "")
    if [ -n "$ALB_ARN" ] && [ "$ALB_ARN" != "None" ]; then
        log "Deleting ALB: shadow-alb"
        aws elbv2 delete-load-balancer --load-balancer-arn "$ALB_ARN" --region "$AWS_REGION" --profile "$AWS_PROFILE" || true
    fi
}

# Step 6: Clean up ECR repositories
cleanup_ecr() {
    log "Step 6: Cleaning up ECR repositories..."
    
    ECR_REPOS=("shadow-server" "shadow-sidecar")
    for REPO in "${ECR_REPOS[@]}"; do
        if aws ecr describe-repositories --repository-names "$REPO" --region "$AWS_REGION" --profile "$AWS_PROFILE" &>/dev/null; then
            log "Deleting ECR repository: $REPO"
            aws ecr delete-repository --repository-name "$REPO" --force --region "$AWS_REGION" --profile "$AWS_PROFILE" || true
        fi
    done
}

# Main execution
main() {
    log "🧹 Starting Shadow infrastructure cleanup..."
    log "Cluster: $CLUSTER_NAME"
    log "Region: $AWS_REGION"
    log ""
    
    warn "This will DELETE ALL Shadow-related AWS resources!"
    read -p "Are you sure you want to continue? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        log "Cleanup cancelled"
        exit 0
    fi
    
    # Try eksctl first (cleanest approach)
    if ! cleanup_eks_cluster; then
        # Fall back to manual cleanup
        cleanup_cloudformation_stacks
        sleep 30  # Wait for resources to be released
        cleanup_vpcs
    else
        # Even if eksctl succeeds, clean up Kubernetes resources first
        cleanup_kubernetes_resources
    fi
    
    cleanup_ecs_resources
    cleanup_ecr
    
    log "🎉 Cleanup completed!"
    log ""
    log "Note: Some resources may take a few minutes to fully delete."
    log "If you see any remaining resources, run this script again."
}

# Run main function
main "$@"