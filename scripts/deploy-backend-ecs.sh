#!/bin/bash

# Shadow Backend ECS Deployment Script
# Deploys the Node.js backend server to AWS ECS in the same VPC as remote execution K8s cluster

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Create logs directory
LOGS_DIR="$SCRIPT_DIR/logs"
mkdir -p "$LOGS_DIR"
LOG_FILE="$LOGS_DIR/ecs-deploy-$(date +%Y%m%d-%H%M%S).log"

# Configuration
CLUSTER_NAME="${EKS_CLUSTER_NAME:-shadow-remote}"
ECS_CLUSTER_NAME="${ECS_CLUSTER_NAME:-shadow-ecs-cluster}"
ECR_REPO_NAME="${ECR_REPO_NAME:-shadow-server}"
AWS_REGION="${AWS_REGION:-us-east-1}"
AWS_PROFILE="${AWS_PROFILE:-ID}"
SERVICE_NAME="${SERVICE_NAME:-shadow-backend-service}"
TASK_FAMILY="${TASK_FAMILY:-shadow-server-task}"
DESIRED_COUNT="${DESIRED_COUNT:-1}"

# Resource Configuration
TASK_CPU="${TASK_CPU:-1024}"
TASK_MEMORY="${TASK_MEMORY:-2048}"
CONTAINER_PORT="${CONTAINER_PORT:-4000}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log() {
    echo -e "${GREEN}[ECS-DEPLOY]${NC} $1"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG_FILE"
}

warn() {
    echo -e "${YELLOW}[ECS-DEPLOY]${NC} $1"
}

error() {
    echo -e "${RED}[ECS-DEPLOY]${NC} $1"
    exit 1
}

info() {
    echo -e "${BLUE}[ECS-DEPLOY]${NC} $1"
}

# Check prerequisites
check_prerequisites() {
    log "Checking prerequisites..."
    
    # Check AWS CLI
    if ! command -v aws &> /dev/null; then
        error "AWS CLI is required but not installed"
    fi
    
    # Check Docker
    if ! command -v docker &> /dev/null; then
        error "Docker is required but not installed"
    fi
    
    # Check AWS credentials
    if ! aws sts get-caller-identity --profile "$AWS_PROFILE" &> /dev/null; then
        error "AWS credentials not configured for profile '$AWS_PROFILE'"
    fi
    
    # Check if EKS cluster exists
    if ! aws eks describe-cluster --name "$CLUSTER_NAME" --region "$AWS_REGION" --profile "$AWS_PROFILE" &> /dev/null; then
        error "EKS cluster '$CLUSTER_NAME' not found. Run deploy-remote-infrastructure.sh first"
    fi
    
    log "Prerequisites check passed"
}

# Get VPC information from existing EKS cluster
get_vpc_info() {
    log "Getting VPC information from EKS cluster..."
    
    # Get VPC ID
    VPC_ID=$(aws eks describe-cluster --name "$CLUSTER_NAME" --region "$AWS_REGION" --profile "$AWS_PROFILE" --query 'cluster.resourcesVpcConfig.vpcId' --output text)
    
    # Get all subnet IDs from EKS cluster
    ALL_SUBNET_IDS=$(aws eks describe-cluster --name "$CLUSTER_NAME" --region "$AWS_REGION" --profile "$AWS_PROFILE" --query 'cluster.resourcesVpcConfig.subnetIds' --output text)
    
    # Filter subnets to get one per unique Availability Zone for ALB
    log "Filtering subnets to unique Availability Zones for Load Balancer..."
    UNIQUE_SUBNETS=""
    SEEN_AZS=""
    
    for subnet_id in $ALL_SUBNET_IDS; do
        # Get AZ for this subnet
        AZ=$(aws ec2 describe-subnets --subnet-ids "$subnet_id" --region "$AWS_REGION" --profile "$AWS_PROFILE" --query 'Subnets[0].AvailabilityZone' --output text)
        
        # Check if we've seen this AZ before
        if [[ ! " $SEEN_AZS " =~ " $AZ " ]]; then
            SEEN_AZS="$SEEN_AZS $AZ"
            if [[ -n "$UNIQUE_SUBNETS" ]]; then
                UNIQUE_SUBNETS="$UNIQUE_SUBNETS,$subnet_id"
            else
                UNIQUE_SUBNETS="$subnet_id"
            fi
        fi
    done
    
    SUBNET_IDS="$UNIQUE_SUBNETS"
    
    # Get cluster security group
    CLUSTER_SG=$(aws eks describe-cluster --name "$CLUSTER_NAME" --region "$AWS_REGION" --profile "$AWS_PROFILE" --query 'cluster.resourcesVpcConfig.clusterSecurityGroupId' --output text)
    
    # Get account ID
    ACCOUNT_ID=$(aws sts get-caller-identity --profile "$AWS_PROFILE" --query 'Account' --output text)
    
    log "VPC ID: $VPC_ID"
    log "Subnets: $SUBNET_IDS"
    log "Cluster SG: $CLUSTER_SG"
    log "Account ID: $ACCOUNT_ID"
}

# Create ECR repository
create_ecr_repository() {
    log "Creating ECR repository..."
    
    # Check if repository exists
    if aws ecr describe-repositories --repository-names "$ECR_REPO_NAME" --region "$AWS_REGION" --profile "$AWS_PROFILE" &> /dev/null; then
        warn "ECR repository '$ECR_REPO_NAME' already exists"
        return 0
    fi
    
    # Create repository
    aws ecr create-repository \
        --repository-name "$ECR_REPO_NAME" \
        --region "$AWS_REGION" \
        --profile "$AWS_PROFILE" \
        --image-scanning-configuration scanOnPush=true \
        --encryption-configuration encryptionType=AES256
    
    log "ECR repository created successfully"
}

# Build and push Docker image
build_and_push_image() {
    log "Building and pushing Docker image..."
    
    # Get ECR login token
    aws ecr get-login-password --region "$AWS_REGION" --profile "$AWS_PROFILE" | \
        docker login --username AWS --password-stdin "$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com"
    
    # Build image for amd64 architecture using buildx (required for ECS Fargate on Apple Silicon)
    log "Building Docker image for amd64 architecture using buildx..."
    cd "$PROJECT_ROOT"
    
    # Ensure buildx builder exists and is active
    docker buildx create --use --name shadow-builder 2>/dev/null || docker buildx use shadow-builder 2>/dev/null || true
    
    # Build with buildx for true cross-platform support
    docker buildx build --platform linux/amd64 -f apps/server/Dockerfile -t "$ECR_REPO_NAME:latest" . --load
    
    # Tag image for ECR
    docker tag "$ECR_REPO_NAME:latest" "$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$ECR_REPO_NAME:latest"
    
    # Push image
    log "Pushing image to ECR..."
    docker push "$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$ECR_REPO_NAME:latest"
    
    log "Docker image pushed successfully"
}

# Create security group for ECS
create_security_group() {
    log "Creating security group for ECS..."
    
    # Check if security group exists
    if aws ec2 describe-security-groups --filters "Name=group-name,Values=shadow-ecs-sg" "Name=vpc-id,Values=$VPC_ID" --region "$AWS_REGION" --profile "$AWS_PROFILE" --query 'SecurityGroups[0].GroupId' --output text 2>/dev/null | grep -q "sg-"; then
        ECS_SG=$(aws ec2 describe-security-groups --filters "Name=group-name,Values=shadow-ecs-sg" "Name=vpc-id,Values=$VPC_ID" --region "$AWS_REGION" --profile "$AWS_PROFILE" --query 'SecurityGroups[0].GroupId' --output text)
        warn "Security group 'shadow-ecs-sg' already exists: $ECS_SG"
        return 0
    fi
    
    # Create security group
    ECS_SG=$(aws ec2 create-security-group \
        --group-name shadow-ecs-sg \
        --description "Security group for Shadow ECS backend server" \
        --vpc-id "$VPC_ID" \
        --region "$AWS_REGION" \
        --profile "$AWS_PROFILE" \
        --query 'GroupId' \
        --output text)
    
    # Allow inbound traffic on container port from ALB
    aws ec2 authorize-security-group-ingress \
        --group-id "$ECS_SG" \
        --protocol tcp \
        --port "$CONTAINER_PORT" \
        --source-group "$ECS_SG" \
        --region "$AWS_REGION" \
        --profile "$AWS_PROFILE"
    
    # Allow communication with K8s cluster
    aws ec2 authorize-security-group-ingress \
        --group-id "$ECS_SG" \
        --protocol tcp \
        --port 443 \
        --source-group "$CLUSTER_SG" \
        --region "$AWS_REGION" \
        --profile "$AWS_PROFILE" || true
    
    # Allow outbound to K8s cluster
    aws ec2 authorize-security-group-egress \
        --group-id "$ECS_SG" \
        --protocol tcp \
        --port 443 \
        --destination-group "$CLUSTER_SG" \
        --region "$AWS_REGION" \
        --profile "$AWS_PROFILE" || true
    
    # Update K8s security group to allow ECS communication
    aws ec2 authorize-security-group-ingress \
        --group-id "$CLUSTER_SG" \
        --protocol tcp \
        --port 443 \
        --source-group "$ECS_SG" \
        --region "$AWS_REGION" \
        --profile "$AWS_PROFILE" || true
    
    log "Security group created: $ECS_SG"
}

# Create IAM roles
create_iam_roles() {
    log "Creating IAM roles..."
    
    # Create ECS task execution role
    cat > trust-policy.json << EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "ecs-tasks.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
EOF
    
    # Create execution role if it doesn't exist
    if ! aws iam get-role --role-name shadowECSExecutionRole --profile "$AWS_PROFILE" &> /dev/null; then
        aws iam create-role \
            --role-name shadowECSExecutionRole \
            --assume-role-policy-document file://trust-policy.json \
            --profile "$AWS_PROFILE"
        
        aws iam attach-role-policy \
            --role-name shadowECSExecutionRole \
            --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy \
            --profile "$AWS_PROFILE"
        
        # Add SSM Parameter Store permissions for secrets
        cat > ssm-policy.json << EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ssm:GetParameters",
        "ssm:GetParameter"
      ],
      "Resource": "arn:aws:ssm:$AWS_REGION:$ACCOUNT_ID:parameter/shadow/*"
    }
  ]
}
EOF
        
        aws iam put-role-policy \
            --role-name shadowECSExecutionRole \
            --policy-name shadowSSMAccess \
            --policy-document file://ssm-policy.json \
            --profile "$AWS_PROFILE"
            
        rm -f ssm-policy.json
    else
        # Role exists, but ensure SSM permissions are added
        log "ECS execution role exists, adding SSM permissions..."
        cat > ssm-policy.json << EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ssm:GetParameters",
        "ssm:GetParameter"
      ],
      "Resource": "arn:aws:ssm:$AWS_REGION:$ACCOUNT_ID:parameter/shadow/*"
    }
  ]
}
EOF
        
        aws iam put-role-policy \
            --role-name shadowECSExecutionRole \
            --policy-name shadowSSMAccess \
            --policy-document file://ssm-policy.json \
            --profile "$AWS_PROFILE" || true
            
        rm -f ssm-policy.json
    fi
    
    # Create task role with K8s permissions
    cat > task-policy.json << EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "eks:DescribeCluster",
        "eks:ListClusters"
      ],
      "Resource": "arn:aws:eks:$AWS_REGION:$ACCOUNT_ID:cluster/$CLUSTER_NAME"
    },
    {
      "Effect": "Allow",
      "Action": [
        "ssm:GetParameter",
        "ssm:GetParameters"
      ],
      "Resource": "arn:aws:ssm:$AWS_REGION:$ACCOUNT_ID:parameter/shadow/*"
    }
  ]
}
EOF
    
    if ! aws iam get-role --role-name shadowECSTaskRole --profile "$AWS_PROFILE" &> /dev/null; then
        aws iam create-role \
            --role-name shadowECSTaskRole \
            --assume-role-policy-document file://trust-policy.json \
            --profile "$AWS_PROFILE"
        
        aws iam put-role-policy \
            --role-name shadowECSTaskRole \
            --policy-name shadowK8sAccess \
            --policy-document file://task-policy.json \
            --profile "$AWS_PROFILE"
    fi
    
    # Clean up temporary files
    rm -f trust-policy.json task-policy.json
    
    log "IAM roles created successfully"
}

# Store secrets in Systems Manager Parameter Store
store_secrets() {
    log "Storing application secrets in Parameter Store..."
    
    # Check if .env.production exists, recreate from initial if missing
    if [[ ! -f ".env.production" ]]; then
        if [[ ! -f ".env.production.initial" ]]; then
            error ".env.production.initial not found. This file is required for ECS deployment"
        fi
        
        warn ".env.production not found, regenerating from .env.production.initial..."
        cp ".env.production.initial" ".env.production"
        
        # Add placeholder for K8s token (will be skipped since it's empty)
        echo "K8S_SERVICE_ACCOUNT_TOKEN=" >> ".env.production"
    fi
    
    # Extract secrets from config file
    K8S_TOKEN=$(grep "K8S_SERVICE_ACCOUNT_TOKEN=" .env.production | cut -d'=' -f2)
    DATABASE_URL=$(grep "DATABASE_URL=" .env.production | cut -d'=' -f2 | tr -d '"')
    PINECONE_API_KEY=$(grep "PINECONE_API_KEY=" .env.production | cut -d'=' -f2 | tr -d '"')
    PINECONE_INDEX_NAME=$(grep "PINECONE_INDEX_NAME=" .env.production | cut -d'=' -f2 | tr -d '"')
    GITHUB_CLIENT_ID=$(grep "GITHUB_CLIENT_ID=" .env.production | cut -d'=' -f2)
    GITHUB_CLIENT_SECRET=$(grep "GITHUB_CLIENT_SECRET=" .env.production | cut -d'=' -f2)
    GITHUB_WEBHOOK_SECRET=$(grep "GITHUB_WEBHOOK_SECRET=" .env.production | cut -d'=' -f2)
    VM_IMAGE_REGISTRY=$(grep "VM_IMAGE_REGISTRY=" .env.production | cut -d'=' -f2 | tr -d '"')
    
    # Validate required secrets
    if [[ -z "$K8S_TOKEN" ]]; then
        warn "K8S service account token not found - you may need to run deploy-remote-infrastructure.sh first if using remote mode"
        warn "Proceeding without K8s token - ensure you have an existing K8s token in Parameter Store or run remote deployment first"
    fi
    
    if [[ -z "$DATABASE_URL" ]]; then
        error "DATABASE_URL not found in .env.production"
    fi
    
    if [[ -z "$VM_IMAGE_REGISTRY" ]]; then
        warn "VM_IMAGE_REGISTRY not found - using default ghcr.io/ishaan1013/shadow"
        VM_IMAGE_REGISTRY="ghcr.io/ishaan1013/shadow"
    fi
    
    # Store all secrets in Parameter Store
    if [[ -n "$K8S_TOKEN" ]]; then
        log "Storing K8s service account token..."
        aws ssm put-parameter \
            --name "/shadow/k8s-token" \
            --value "$K8S_TOKEN" \
            --type "SecureString" \
            --overwrite \
            --region "$AWS_REGION" \
            --profile "$AWS_PROFILE"
    fi
    
    log "Storing database URL..."
    aws ssm put-parameter \
        --name "/shadow/database-url" \
        --value "$DATABASE_URL" \
        --type "SecureString" \
        --overwrite \
        --region "$AWS_REGION" \
        --profile "$AWS_PROFILE"
    
    if [[ -n "$PINECONE_API_KEY" ]]; then
        log "Storing Pinecone API key..."
        aws ssm put-parameter \
            --name "/shadow/pinecone-api-key" \
            --value "$PINECONE_API_KEY" \
            --type "SecureString" \
            --overwrite \
            --region "$AWS_REGION" \
            --profile "$AWS_PROFILE"
    fi
    
    if [[ -n "$PINECONE_INDEX_NAME" ]]; then
        log "Storing Pinecone index name..."
        aws ssm put-parameter \
            --name "/shadow/pinecone-index-name" \
            --value "$PINECONE_INDEX_NAME" \
            --type "String" \
            --overwrite \
            --region "$AWS_REGION" \
            --profile "$AWS_PROFILE"
    fi
    
    if [[ -n "$GITHUB_CLIENT_ID" ]]; then
        log "Storing GitHub client ID..."
        aws ssm put-parameter \
            --name "/shadow/github-client-id" \
            --value "$GITHUB_CLIENT_ID" \
            --type "String" \
            --overwrite \
            --region "$AWS_REGION" \
            --profile "$AWS_PROFILE"
    fi
    
    if [[ -n "$GITHUB_CLIENT_SECRET" ]]; then
        log "Storing GitHub client secret..."
        aws ssm put-parameter \
            --name "/shadow/github-client-secret" \
            --value "$GITHUB_CLIENT_SECRET" \
            --type "SecureString" \
            --overwrite \
            --region "$AWS_REGION" \
            --profile "$AWS_PROFILE"
    fi
    
    if [[ -n "$GITHUB_WEBHOOK_SECRET" ]]; then
        log "Storing GitHub webhook secret..."
        aws ssm put-parameter \
            --name "/shadow/github-webhook-secret" \
            --value "$GITHUB_WEBHOOK_SECRET" \
            --type "SecureString" \
            --overwrite \
            --region "$AWS_REGION" \
            --profile "$AWS_PROFILE"
    fi
    
    log "Storing VM image registry..."
    aws ssm put-parameter \
        --name "/shadow/vm-image-registry" \
        --value "$VM_IMAGE_REGISTRY" \
        --type "String" \
        --overwrite \
        --region "$AWS_REGION" \
        --profile "$AWS_PROFILE"
    
    log "All secrets stored in Parameter Store successfully"
}

# Create ECS cluster
create_ecs_cluster() {
    log "Creating ECS cluster..."
    
    # Create ECS service-linked role if it doesn't exist
    if ! aws iam get-role --role-name AWSServiceRoleForECS --profile "$AWS_PROFILE" &> /dev/null; then
        log "Creating ECS service-linked role..."
        aws iam create-service-linked-role --aws-service-name ecs.amazonaws.com --profile "$AWS_PROFILE" || true
        # Wait a moment for role to propagate
        sleep 10
    fi
    
    # Check if cluster exists
    if aws ecs describe-clusters --clusters "$ECS_CLUSTER_NAME" --region "$AWS_REGION" --profile "$AWS_PROFILE" --query 'clusters[0].status' --output text 2>/dev/null | grep -q "ACTIVE"; then
        warn "ECS cluster '$ECS_CLUSTER_NAME' already exists"
        return 0
    fi
    
    # Create cluster
    aws ecs create-cluster \
        --cluster-name "$ECS_CLUSTER_NAME" \
        --capacity-providers FARGATE \
        --default-capacity-provider-strategy capacityProvider=FARGATE,weight=1 \
        --region "$AWS_REGION" \
        --profile "$AWS_PROFILE"
    
    log "ECS cluster created successfully"
}

# Create Application Load Balancer
create_load_balancer() {
    log "Creating Application Load Balancer..."
    
    # Check if ALB exists
    if aws elbv2 describe-load-balancers --names shadow-alb --region "$AWS_REGION" --profile "$AWS_PROFILE" &> /dev/null; then
        ALB_ARN=$(aws elbv2 describe-load-balancers --names shadow-alb --region "$AWS_REGION" --profile "$AWS_PROFILE" --query 'LoadBalancers[0].LoadBalancerArn' --output text)
        warn "Load balancer 'shadow-alb' already exists: $ALB_ARN"
    else
        # Create ALB
        ALB_ARN=$(aws elbv2 create-load-balancer \
            --name shadow-alb \
            --subnets $(echo $SUBNET_IDS | tr ',' ' ') \
            --security-groups "$ECS_SG" \
            --scheme internet-facing \
            --type application \
            --region "$AWS_REGION" \
            --profile "$AWS_PROFILE" \
            --query 'LoadBalancers[0].LoadBalancerArn' \
            --output text)
        
        log "Load balancer created: $ALB_ARN"
    fi
    
    # Create target group
    TG_ARN=$(aws elbv2 create-target-group \
        --name shadow-targets \
        --protocol HTTP \
        --port "$CONTAINER_PORT" \
        --vpc-id "$VPC_ID" \
        --target-type ip \
        --health-check-path /health \
        --health-check-interval-seconds 30 \
        --health-check-timeout-seconds 5 \
        --healthy-threshold-count 2 \
        --unhealthy-threshold-count 3 \
        --region "$AWS_REGION" \
        --profile "$AWS_PROFILE" \
        --query 'TargetGroups[0].TargetGroupArn' \
        --output text 2>/dev/null || \
    aws elbv2 describe-target-groups \
        --names shadow-targets \
        --region "$AWS_REGION" \
        --profile "$AWS_PROFILE" \
        --query 'TargetGroups[0].TargetGroupArn' \
        --output text)
    
    # Enable sticky sessions for WebSocket (check if already enabled first)
    log "Checking sticky sessions on target group..."
    if aws elbv2 describe-target-group-attributes --target-group-arn "$TG_ARN" --region "$AWS_REGION" --profile "$AWS_PROFILE" --query 'Attributes[?Key==`stickiness.enabled`].Value' --output text | grep -q "true"; then
        log "Sticky sessions already enabled"
    else
        log "Enabling sticky sessions on target group..."
        aws elbv2 modify-target-group-attributes \
            --target-group-arn "$TG_ARN" \
            --attributes Key=stickiness.enabled,Value=true Key=stickiness.type,Value=lb_cookie Key=stickiness.lb_cookie.duration_seconds,Value=86400 \
            --region "$AWS_REGION" \
            --profile "$AWS_PROFILE" || warn "Failed to enable sticky sessions, continuing..."
    fi
    
    # Create listener
    log "Creating ALB listener..."
    aws elbv2 create-listener \
        --load-balancer-arn "$ALB_ARN" \
        --protocol HTTP \
        --port 80 \
        --default-actions Type=forward,TargetGroupArn="$TG_ARN" \
        --region "$AWS_REGION" \
        --profile "$AWS_PROFILE" 2>/dev/null || warn "Listener creation failed or already exists, continuing..."
    
    log "Load balancer and target group configured"
}

# Create task definition
create_task_definition() {
    log "Creating ECS task definition..."
    
    # Get K8s cluster endpoint
    CLUSTER_ENDPOINT=$(aws eks describe-cluster --name "$CLUSTER_NAME" --region "$AWS_REGION" --profile "$AWS_PROFILE" --query 'cluster.endpoint' --output text)
    K8S_HOST=${CLUSTER_ENDPOINT#https://}
    
    # Create task definition
    cat > task-definition.json << EOF
{
  "family": "$TASK_FAMILY",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "$TASK_CPU",
  "memory": "$TASK_MEMORY",
  "runtimePlatform": {
    "operatingSystemFamily": "LINUX",
    "cpuArchitecture": "X86_64"
  },
  "executionRoleArn": "arn:aws:iam::$ACCOUNT_ID:role/shadowECSExecutionRole",
  "taskRoleArn": "arn:aws:iam::$ACCOUNT_ID:role/shadowECSTaskRole",
  "containerDefinitions": [
    {
      "name": "shadow-server",
      "image": "$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$ECR_REPO_NAME:latest",
      "portMappings": [
        {
          "containerPort": $CONTAINER_PORT,
          "protocol": "tcp"
        }
      ],
      "environment": [
        {"name": "NODE_ENV", "value": "production"},
        {"name": "AGENT_MODE", "value": "remote"},
        {"name": "AWS_REGION", "value": "$AWS_REGION"},
        {"name": "EKS_CLUSTER_NAME", "value": "$CLUSTER_NAME"},
        {"name": "KUBERNETES_NAMESPACE", "value": "shadow-agents"},
        {"name": "KUBERNETES_SERVICE_HOST", "value": "$K8S_HOST"},
        {"name": "KUBERNETES_SERVICE_PORT", "value": "443"}
      ],
      "secrets": [
        {"name": "K8S_SERVICE_ACCOUNT_TOKEN", "valueFrom": "arn:aws:ssm:$AWS_REGION:$ACCOUNT_ID:parameter/shadow/k8s-token"},
        {"name": "DATABASE_URL", "valueFrom": "arn:aws:ssm:$AWS_REGION:$ACCOUNT_ID:parameter/shadow/database-url"},
        {"name": "PINECONE_API_KEY", "valueFrom": "arn:aws:ssm:$AWS_REGION:$ACCOUNT_ID:parameter/shadow/pinecone-api-key"},
        {"name": "PINECONE_INDEX_NAME", "valueFrom": "arn:aws:ssm:$AWS_REGION:$ACCOUNT_ID:parameter/shadow/pinecone-index-name"},
        {"name": "GITHUB_CLIENT_ID", "valueFrom": "arn:aws:ssm:$AWS_REGION:$ACCOUNT_ID:parameter/shadow/github-client-id"},
        {"name": "GITHUB_CLIENT_SECRET", "valueFrom": "arn:aws:ssm:$AWS_REGION:$ACCOUNT_ID:parameter/shadow/github-client-secret"},
        {"name": "GITHUB_WEBHOOK_SECRET", "valueFrom": "arn:aws:ssm:$AWS_REGION:$ACCOUNT_ID:parameter/shadow/github-webhook-secret"},
        {"name": "VM_IMAGE_REGISTRY", "valueFrom": "arn:aws:ssm:$AWS_REGION:$ACCOUNT_ID:parameter/shadow/vm-image-registry"}
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/shadow-server",
          "awslogs-region": "$AWS_REGION",
          "awslogs-stream-prefix": "ecs",
          "awslogs-create-group": "true"
        }
      },
      "healthCheck": {
        "command": ["CMD-SHELL", "curl -f http://localhost:$CONTAINER_PORT/health || exit 1"],
        "interval": 30,
        "timeout": 5,
        "retries": 3,
        "startPeriod": 60
      }
    }
  ]
}
EOF
    
    # Check if identical task definition already exists
    log "Checking for existing task definition..."
    if aws ecs describe-task-definition --task-definition "$TASK_FAMILY" --region "$AWS_REGION" --profile "$AWS_PROFILE" &> /dev/null; then
        # Get current task definition content (excluding metadata)
        CURRENT_TASK_DEF=$(aws ecs describe-task-definition --task-definition "$TASK_FAMILY" --region "$AWS_REGION" --profile "$AWS_PROFILE" --query 'taskDefinition.{family:family,networkMode:networkMode,requiresCompatibilities:requiresCompatibilities,cpu:cpu,memory:memory,runtimePlatform:runtimePlatform,executionRoleArn:executionRoleArn,taskRoleArn:taskRoleArn,containerDefinitions:containerDefinitions}' --output json)
        NEW_TASK_DEF=$(cat task-definition.json)
        
        # Compare definitions (basic check - could be enhanced)
        if echo "$CURRENT_TASK_DEF" | jq -S . > current_def.json && echo "$NEW_TASK_DEF" | jq -S . > new_def.json; then
            if cmp -s current_def.json new_def.json; then
                log "Task definition is identical to existing version, skipping registration"
                rm -f current_def.json new_def.json
                # Clean up and return early
                rm -f task-definition.json
                log "Task definition creation completed (no changes)"
                return 0
            else
                log "Task definition has changes, registering new revision..."
                rm -f current_def.json new_def.json
            fi
        else
            log "Could not compare task definitions, proceeding with registration..."
        fi
    fi
    
    # Register task definition
    log "Registering ECS task definition..."
    log "Detailed output streaming to: $LOG_FILE"
    if aws ecs register-task-definition \
        --cli-input-json file://task-definition.json \
        --region "$AWS_REGION" \
        --profile "$AWS_PROFILE" >> "$LOG_FILE" 2>&1; then
        log "Task definition registered successfully"
    else
        warn "Task definition registration failed, checking if it exists..."
        # Check if task definition was created despite failure
        if aws ecs describe-task-definition --task-definition "$TASK_FAMILY" --region "$AWS_REGION" --profile "$AWS_PROFILE" &> /dev/null; then
            log "Task definition exists, continuing..."
        else
            error "Task definition registration failed and does not exist"
        fi
    fi
    
    # Clean up
    rm -f task-definition.json
    
    log "Task definition creation completed"
}

# Create ECS service
create_ecs_service() {
    log "Creating ECS service..."
    
    # Check if service exists
    if aws ecs describe-services --cluster "$ECS_CLUSTER_NAME" --services "$SERVICE_NAME" --region "$AWS_REGION" --profile "$AWS_PROFILE" --query 'services[0].status' --output text 2>/dev/null | grep -q "ACTIVE"; then
        warn "ECS service '$SERVICE_NAME' already exists"
        return 0
    fi
    
    # Create service
    aws ecs create-service \
        --cluster "$ECS_CLUSTER_NAME" \
        --service-name "$SERVICE_NAME" \
        --task-definition "$TASK_FAMILY" \
        --desired-count "$DESIRED_COUNT" \
        --launch-type FARGATE \
        --platform-version LATEST \
        --network-configuration "awsvpcConfiguration={subnets=[$SUBNET_IDS],securityGroups=[$ECS_SG],assignPublicIp=ENABLED}" \
        --load-balancers "targetGroupArn=$TG_ARN,containerName=shadow-server,containerPort=$CONTAINER_PORT" \
        --health-check-grace-period-seconds 300 \
        --region "$AWS_REGION" \
        --profile "$AWS_PROFILE"
    
    log "ECS service created successfully"
}

# Get service information
get_service_info() {
    log "Getting service information..."
    
    # Get ALB DNS name
    ALB_DNS=$(aws elbv2 describe-load-balancers --names shadow-alb --region "$AWS_REGION" --profile "$AWS_PROFILE" --query 'LoadBalancers[0].DNSName' --output text)
    
    # Get service status
    SERVICE_STATUS=$(aws ecs describe-services --cluster "$ECS_CLUSTER_NAME" --services "$SERVICE_NAME" --region "$AWS_REGION" --profile "$AWS_PROFILE" --query 'services[0].status' --output text)
    
    # Get running tasks count
    RUNNING_TASKS=$(aws ecs describe-services --cluster "$ECS_CLUSTER_NAME" --services "$SERVICE_NAME" --region "$AWS_REGION" --profile "$AWS_PROFILE" --query 'services[0].runningCount' --output text)
    
    log "Service Status: $SERVICE_STATUS"
    log "Running Tasks: $RUNNING_TASKS"
    log "Load Balancer DNS: http://$ALB_DNS"
    
    # Save configuration
    cat > .env.ecs-result << EOF
# Shadow ECS Deployment Configuration
# Generated on: $(date -u +%Y-%m-%dT%H:%M:%SZ)

# ECS Configuration
ECS_CLUSTER_NAME=$ECS_CLUSTER_NAME
SERVICE_NAME=$SERVICE_NAME
TASK_FAMILY=$TASK_FAMILY

# Load Balancer
ALB_DNS_NAME=$ALB_DNS
BACKEND_URL=http://$ALB_DNS

# AWS Configuration
AWS_REGION=$AWS_REGION
VPC_ID=$VPC_ID
ECS_SECURITY_GROUP=$ECS_SG

# ECR
ECR_REPOSITORY_URI=$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$ECR_REPO_NAME
EOF
    
    log "Configuration saved to: .env.ecs-result"
}

# Verify deployment
verify_deployment() {
    log "Verifying ECS deployment..."
    
    # Wait for service to be stable
    log "Waiting for service to stabilize..."
    aws ecs wait services-stable \
        --cluster "$ECS_CLUSTER_NAME" \
        --services "$SERVICE_NAME" \
        --region "$AWS_REGION" \
        --profile "$AWS_PROFILE"
    
    # Check service health
    log "Checking service health..."
    HEALTHY_TARGETS=$(aws elbv2 describe-target-health --target-group-arn "$TG_ARN" --region "$AWS_REGION" --profile "$AWS_PROFILE" --query 'TargetHealthDescriptions[?TargetHealth.State==`healthy`] | length(@)')
    
    log "Healthy targets: $HEALTHY_TARGETS"
    
    if [[ "$HEALTHY_TARGETS" -gt 0 ]]; then
        log "✅ ECS deployment verification successful"
    else
        warn "❌ No healthy targets found. Check service logs:"
        log "aws logs tail /ecs/shadow-server --follow --region $AWS_REGION --profile $AWS_PROFILE"
    fi
}

# Main execution
main() {
    log "Starting Shadow backend ECS deployment..."
    log "EKS Cluster: $CLUSTER_NAME"
    log "ECS Cluster: $ECS_CLUSTER_NAME"
    log "Region: $AWS_REGION"
    
    check_prerequisites
    get_vpc_info
    create_ecr_repository
    build_and_push_image
    create_security_group
    create_iam_roles
    store_secrets
    create_ecs_cluster
    create_load_balancer
    create_task_definition
    create_ecs_service
    get_service_info
    verify_deployment
    
    log "🎉 Shadow backend deployed to ECS successfully!"
    log ""
    log "Next steps:"
    log "1. Update your frontend to use: http://$ALB_DNS"
    log "2. Test WebSocket connections"
    log "3. Verify remote VM communication"
    log ""
    log "Useful commands:"
    log "- Check service: aws ecs describe-services --cluster $ECS_CLUSTER_NAME --services $SERVICE_NAME"
    log "- View logs: aws logs tail /ecs/shadow-server --follow"
    log "- Scale service: aws ecs update-service --cluster $ECS_CLUSTER_NAME --service $SERVICE_NAME --desired-count N"
}

# Handle cleanup on exit
cleanup() {
    log "Cleaning up temporary files..."
    rm -f task-definition.json trust-policy.json task-policy.json
}

trap cleanup EXIT

# Run main function
main "$@"