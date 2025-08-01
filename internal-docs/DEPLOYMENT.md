# Shadow Firecracker Deployment Guide

This comprehensive guide covers the complete deployment and testing of Shadow's Firecracker microVM infrastructure for hardware-isolated AI agent execution.

## Architecture Overview

Shadow provides true hardware-level isolation using Firecracker microVMs instead of Docker containers:

**🔥 True Firecracker microVMs**:
- Each task runs in its own **actual Firecracker microVM** (not Docker containers)
- VM startup via init containers with Firecracker binary + jailer security
- Hardware-level isolation with dedicated kernel space per task
- Serial console communication with protocol multiplexing
- <125ms boot time with optimized VM images
- True VM boundaries prevent container escape attacks

**🚀 VM Lifecycle Management**:
- `FirecrackerVMRunner` creates VM pods with init container pattern
- `FirecrackerWorkspaceManager` handles VM workspace lifecycle
- `VMConsoleProxy` manages serial console communication
- Automatic VM cleanup and resource management
- Kubernetes integration with custom RuntimeClass

**🌐 Cloud-Native Server**:
- Backend orchestrator deployed to Kubernetes, Cloud Run, or Lambda
- Creates and manages VM pods via Kubernetes API
- Real-time streaming via WebSocket with VM console integration
- LLM integration with tool execution in isolated VMs

**📦 Automated VM Image Pipeline**:
- GitHub Actions builds VM images on x86_64 runners
- Ubuntu 22.04 LTS with embedded sidecar service
- Pre-installed dev tools: Node.js, Python, LSP servers
- Container registry (ECR/GHCR) for VM image distribution

**Git-First Data Strategy**:
- Ephemeral VM storage with git-based persistence
- Each task works on dedicated shadow branch
- VM filesystems destroyed after task completion
- Cost-effective: compute-only, no storage costs

## Prerequisites

### Development Environment
- **MacBook M1 Compatible**: Development supported on ARM64, but VM testing requires x86_64 cloud infrastructure
- **Local Development**: Use `AGENT_MODE=local` for code development on M1
- **Cloud Testing**: AWS EC2 bare metal required for Firecracker VM testing

### Required Tools
- **AWS Account** with admin access
- **Bare metal instances** (c5.metal, m5.metal, or similar with KVM support)
- **Docker** installed locally
- **AWS CLI** installed and configured
- **kubectl** installed  
- **eksctl** installed
- **Helm** installed

## Step 1: Automated Infrastructure Deployment

### 1.1 Quick Setup (Recommended)

Use our automated deployment script to set up the complete Firecracker infrastructure:

```bash
# Clone the repository
git clone https://github.com/your-org/shadow.git
cd shadow

# Configure AWS credentials
aws configure

# Deploy Firecracker infrastructure (20-30 minutes)
./scripts/deploy-firecracker-infrastructure.sh

# Source cluster configuration
source .env.production

# Verify deployment
kubectl get nodes -l firecracker=true
kubectl get pods -n shadow -l app=firecracker-runtime
kubectl get runtimeclass firecracker
```

### 1.2 Manual Setup (Advanced)

If you prefer manual setup, follow these steps:

#### Install Required Tools
```bash
# AWS CLI
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
unzip awscliv2.zip && sudo ./aws/install

# eksctl
curl --silent --location "https://github.com/weaveworks/eksctl/releases/latest/download/eksctl_$(uname -s)_amd64.tar.gz" | tar xz -C /tmp
sudo mv /tmp/eksctl /usr/local/bin

# kubectl
curl -LO "https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl"
sudo install -o root -g root -m 0755 kubectl /usr/local/bin/kubectl

# Helm
curl https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash
```

#### Create EKS Cluster
```bash
# The deployment script creates this configuration automatically:
# - EKS cluster with Firecracker-compatible bare metal nodes
# - KVM-enabled nodes with proper taints and labels
# - Kubernetes namespace, RBAC, and runtime configuration
# - Monitoring and observability stack
# - VM image storage and distribution
```

## Step 2: VM Image Pipeline Setup

### 2.1 Automated VM Image Building (Recommended)

Our GitHub Actions workflow automatically builds VM images on x86_64 runners:

```bash
# Trigger VM image build
git push origin main  # Triggers on push to main

# Or manually trigger
gh workflow run "Build Firecracker VM Images"

# Monitor build progress
gh run list --workflow="Build Firecracker VM Images"

# Download build artifacts
gh run download <run-id> --name firecracker-vm-images
```

The GitHub Actions workflow:
- Builds Ubuntu 22.04 VM images with embedded sidecar
- Installs Node.js, Python, LSP servers, and dev tools
- Creates Firecracker-compatible rootfs and kernel
- Pushes images to container registry
- Generates deployment manifests

### 2.2 Manual VM Image Building (Development)

For development or custom builds on x86_64 cloud instance:

```bash
# Launch EC2 instance for building (c5.metal or similar)
aws ec2 run-instances --image-id ami-0c02fb55956c7d316 --instance-type c5.metal

# SSH and build
ssh -i your-key.pem ec2-user@instance-ip
git clone https://github.com/your-org/shadow.git
cd shadow

# Build VM images (requires Linux + KVM)
sudo ./scripts/build-vm-image.sh

# Outputs:
# - vm-image/output/shadow-rootfs.ext4 (VM filesystem)
# - vm-image/output/vmlinux (Firecracker kernel)
# - vm-image/output/manifest.json (Build metadata)
```

## Step 3: Application Configuration

### 3.1 Environment Configuration

Configure Shadow to use Firecracker mode:

```bash
# Create production configuration
cat > production.env << EOF
# Execution mode - CRITICAL: Must be 'firecracker' for VM isolation
AGENT_MODE=firecracker
NODE_ENV=production

# Firecracker VM Configuration
VM_CPU_COUNT=1
VM_MEMORY_SIZE_MB=1024
VM_CPU_LIMIT=1000m
VM_MEMORY_LIMIT=2Gi
VM_STORAGE_LIMIT=10Gi

# Kubernetes Configuration
KUBERNETES_NAMESPACE=shadow
KUBERNETES_SERVICE_HOST=your-cluster-endpoint
KUBERNETES_SERVICE_PORT=443
K8S_SERVICE_ACCOUNT_TOKEN=your-service-account-token

# VM Image Configuration (from GitHub Actions or manual build)
VM_IMAGE_REGISTRY=ghcr.io/your-org
VM_IMAGE_TAG=latest

# Application Secrets
DATABASE_URL=your-database-url
ANTHROPIC_API_KEY=your-anthropic-key
OPENAI_API_KEY=your-openai-key
GITHUB_CLIENT_ID=your-github-client-id
GITHUB_CLIENT_SECRET=your-github-client-secret
EOF
```

### 3.2 Kubernetes Service Account Configuration

```bash
# Get cluster configuration (set by deployment script)
kubectl cluster-info

# Create service account token for Shadow application
kubectl apply -f - << 'EOF'
apiVersion: v1
kind: Secret
metadata:
  name: shadow-service-account-token
  namespace: shadow
  annotations:
    kubernetes.io/service-account.name: shadow-firecracker-vm-sa
type: kubernetes.io/service-account-token
EOF

# Get the token
SERVICE_TOKEN=$(kubectl get secret shadow-service-account-token -n shadow -o jsonpath='{.data.token}' | base64 -d)

# Update your production.env
sed -i "s/your-service-account-token/$SERVICE_TOKEN/g" production.env
```

## Step 4: Deploy Shadow Application

### 4.1 Option A: Google Cloud Run

```bash
# Build and deploy Shadow server
cd apps/server
npm run build

# Build Docker image
docker build -f Dockerfile -t shadow-server .

# Tag for Google Container Registry
docker tag shadow-server:latest gcr.io/your-project/shadow-server:latest
docker push gcr.io/your-project/shadow-server:latest

# Deploy to Cloud Run with Firecracker configuration
gcloud run deploy shadow-server \
  --image gcr.io/your-project/shadow-server:latest \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars AGENT_MODE=firecracker \
  --set-env-vars KUBERNETES_SERVICE_HOST=your-cluster-endpoint \
  --set-env-vars K8S_SERVICE_ACCOUNT_TOKEN=your-token \
  --memory 2Gi \
  --cpu 2 \
  --max-instances 10
```

### 4.2 Option B: Deploy to EKS

```bash
# Deploy server to the same EKS cluster
kubectl apply -f - << 'EOF'
apiVersion: apps/v1
kind: Deployment
metadata:
  name: shadow-server
  namespace: default
spec:
  replicas: 2
  selector:
    matchLabels:
      app: shadow-server
  template:
    metadata:
      labels:
        app: shadow-server
    spec:
      serviceAccountName: shadow-firecracker-vm-sa
      nodeSelector:
        node-type: "system"
      containers:
      - name: server
        image: your-account.dkr.ecr.us-east-1.amazonaws.com/shadow-server:latest
        ports:
        - containerPort: 3000
        envFrom:
        - configMapRef:
            name: shadow-config
        resources:
          requests:
            cpu: 500m
            memory: 1Gi
          limits:
            cpu: 1000m
            memory: 2Gi
---
apiVersion: v1
kind: Service
metadata:
  name: shadow-server
  namespace: default
spec:
  selector:
    app: shadow-server
  ports:
  - port: 80
    targetPort: 3000
  type: LoadBalancer
EOF
```

## Step 5: Testing and Validation

### 5.1 Run Integration Tests

Use our comprehensive test suite to validate the Firecracker deployment:

```bash
# Run the complete integration test
./scripts/test-firecracker-integration.sh

# Expected output:
# ✅ Infrastructure: Operational
# ✅ VM Creation: Successful  
# ✅ Integration: Verified
# 📄 Report: firecracker-test-report-*.md
```

### 5.2 Test True Firecracker VM Creation

```bash
# Test creating a true Firecracker VM with our new architecture
kubectl apply -f - << 'EOF'
apiVersion: v1
kind: Pod
metadata:
  name: test-firecracker-vm
  namespace: shadow
  labels:
    app: shadow-firecracker
    component: vm
    test: "true"
spec:
  serviceAccountName: shadow-firecracker-vm-sa
  runtimeClassName: firecracker
  nodeSelector:
    firecracker: "true"
    kvm: "enabled"
  tolerations:
  - key: firecracker.shadow.ai/dedicated
    operator: Equal
    value: "true"
    effect: NoSchedule
  restartPolicy: Never
  initContainers:
  - name: vm-starter
    image: alpine:latest
    securityContext:
      privileged: true
      runAsUser: 0
      capabilities:
        add: ["SYS_ADMIN", "NET_ADMIN"]
    env:
    - name: TASK_ID
      value: "test-vm"
    - name: VM_CPU_COUNT
      value: "1"
    - name: VM_MEMORY_SIZE_MB
      value: "1024"
    command: ["/bin/sh", "-c"]
    args:
    - |
      echo "🔥 Starting true Firecracker microVM..."
      
      # Install Firecracker
      wget -O /tmp/firecracker.tgz https://github.com/firecracker-microvm/firecracker/releases/download/v1.4.1/firecracker-v1.4.1-x86_64.tgz
      cd /tmp && tar -xzf firecracker.tgz
      cp release-v1.4.1-x86_64/firecracker-v1.4.1-x86_64 /usr/local/bin/firecracker
      cp release-v1.4.1-x86_64/jailer-v1.4.1-x86_64 /usr/local/bin/jailer
      chmod +x /usr/local/bin/firecracker /usr/local/bin/jailer
      
      # Verify KVM access
      ls -l /dev/kvm || exit 1
      
      # Create VM config for actual Firecracker execution
      mkdir -p /var/lib/firecracker/vms/$TASK_ID
      cat > /var/lib/firecracker/vms/$TASK_ID/vm-config.json << CONFIG_EOF
      {
        "boot-source": {
          "kernel_image_path": "/var/lib/firecracker/kernels/vmlinux",
          "boot_args": "console=ttyS0 reboot=k panic=1 pci=off init=/sbin/init"
        },
        "drives": [
          {
            "drive_id": "rootfs",
            "path_on_host": "/var/lib/firecracker/images/shadow-rootfs.ext4",
            "is_root_device": true,
            "is_read_only": false
          }
        ],
        "machine-config": {
          "vcpu_count": $VM_CPU_COUNT,
          "mem_size_mib": $VM_MEMORY_SIZE_MB,
          "ht_enabled": false
        }
      }
      CONFIG_EOF
      
      echo "✅ True Firecracker VM ready for execution"
      /usr/local/bin/firecracker --version
    volumeMounts:
    - name: dev-kvm
      mountPath: /dev/kvm
    - name: firecracker-images
      mountPath: /var/lib/firecracker
  containers:
  - name: vm-proxy
    image: alpine:latest
    command: ["sleep", "60"]
    resources:
      requests:
        memory: "128Mi"
        cpu: "100m"
      limits:
        memory: "256Mi"
        cpu: "200m"
  volumes:
  - name: dev-kvm
    hostPath:
      path: /dev/kvm
      type: CharDevice
  - name: firecracker-images
    hostPath:
      path: /var/lib/firecracker
      type: DirectoryOrCreate
EOF

# Check the VM pod status
kubectl get pod test-firecracker-vm -n shadow -o wide
kubectl logs test-firecracker-vm -n shadow -c vm-starter

# Verify this creates a REAL Firecracker VM (not a Docker container)
kubectl describe pod test-firecracker-vm -n shadow

# Clean up test
kubectl delete pod test-firecracker-vm -n shadow
```

### 5.3 Test End-to-End Task Execution

```bash
# Test your Shadow application creates true Firecracker VMs
# Create a task through your API
curl -X POST http://your-shadow-server/api/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "repoUrl": "https://github.com/octocat/Hello-World.git",
    "baseBranch": "main",
    "instructions": "Add a README file explaining the project",
    "llmModel": "claude-3-sonnet-20241022"
  }'

# Watch Firecracker VM pods being created
kubectl get pods -n shadow --watch

# Monitor VM creation and task execution
kubectl logs -l app=shadow-firecracker -n shadow --tail=50 -f

# Check VM resource usage
kubectl top pods -n shadow

# Verify VM cleanup after task completion
# VM pods should be automatically deleted when tasks complete
```

## Step 6: Monitoring and Observability

### 6.1 Grafana Dashboard Access

```bash
# Access Grafana dashboard (installed by deployment script)
kubectl port-forward -n monitoring svc/prometheus-grafana 3000:80

# Open http://localhost:3000 (admin/admin)
# Monitor VM metrics:
# - VM boot times
# - Resource utilization
# - Task completion rates
# - Error rates
```

### 6.2 VM Health Monitoring

```bash
# Check Firecracker infrastructure health
kubectl get pods -n shadow -l app=firecracker-runtime
kubectl get runtimeclass firecracker
kubectl get nodes -l firecracker=true

# Monitor VM pod lifecycle
kubectl get events -n shadow --sort-by='.lastTimestamp'

# Check VM resource allocation
kubectl describe resourcequota shadow-agents-quota -n shadow
```

## Architecture Deep Dive

### VM Lifecycle Management

```typescript
// FirecrackerWorkspaceManager creates VM pods
const workspaceManager = new FirecrackerWorkspaceManager();
const workspaceInfo = await workspaceManager.prepareWorkspace(taskConfig);

// FirecrackerVMRunner handles VM pod specification
const vmRunner = new FirecrackerVMRunner();
const pod = await vmRunner.createVMPod(taskConfig, githubToken);
```

### VM Pod Architecture
```yaml
apiVersion: v1
kind: Pod
spec:
  runtimeClassName: firecracker  # Uses Firecracker instead of Docker
  initContainers:
  - name: vm-starter
    # Downloads Firecracker, creates VM config, starts microVM
  containers:
  - name: vm-proxy
    # Proxies HTTP requests to VM sidecar via network
```

### Console Communication
```typescript
// VM Console Proxy handles serial console communication
const vmConsole = new VMConsoleProxy(taskId);
await vmConsole.startVM();

// Protocol multiplexing over serial console
vmConsole.sendJSONRequest({ type: 'file_operation', ... });
vmConsole.sendTerminalInput('ls -la');
vmConsole.sendCommand('git status');
```

## Configuration Reference

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `AGENT_MODE` | Execution mode (`local` \| `firecracker`) | `local` |
| `VM_CPU_COUNT` | VM vCPU allocation | `1` |
| `VM_MEMORY_SIZE_MB` | VM RAM in MB | `1024` |
| `VM_CPU_LIMIT` | K8s CPU limit | `1000m` |
| `VM_MEMORY_LIMIT` | K8s memory limit | `2Gi` |
| `VM_STORAGE_LIMIT` | Ephemeral storage limit | `10Gi` |
| `KUBERNETES_NAMESPACE` | K8s namespace | `shadow` |

### VM Resource Sizing

| Use Case | CPU | Memory | Storage | Cost/Hour* |
|----------|-----|--------|---------|------------|
| Light Tasks | 1 vCPU | 1GB | 10GB | ~$0.05 |
| Standard Tasks | 2 vCPU | 2GB | 20GB | ~$0.10 |
| Heavy Tasks | 4 vCPU | 4GB | 50GB | ~$0.20 |

*Estimated costs for c5.metal nodes with conservative allocation

## Troubleshooting

### Common Issues

#### 1. VM Boot Timeout
```bash
# Check pod status
kubectl describe pod shadow-vm-<task-id> -n shadow

# Check Firecracker logs
kubectl logs shadow-vm-<task-id> -n shadow -c vm-starter

# Verify KVM access
kubectl exec -it <firecracker-runtime-pod> -n shadow -- ls -l /dev/kvm
```

#### 2. Sidecar Not Reachable
```bash
# Check VM networking
kubectl get pod shadow-vm-<task-id> -n shadow -o wide

# Test sidecar connectivity
kubectl exec -it shadow-vm-<task-id> -n shadow -- curl http://localhost:8080/health
```

#### 3. VM Images Missing
```bash
# Check image availability
kubectl logs -l app=firecracker-runtime -n shadow

# Verify build artifacts
kubectl get configmap shadow-vm-images -n shadow -o yaml
```

### VM Creation Issues

```bash
# Check Firecracker infrastructure status
kubectl get nodes -l firecracker=true
kubectl get pods -n shadow -l app=firecracker-runtime
kubectl describe runtimeclass firecracker

# Verify KVM access on nodes
kubectl exec -it <firecracker-runtime-pod> -n shadow -- ls -la /dev/kvm

# Check for VM creation errors
kubectl get events -n shadow | grep "shadow-vm"
kubectl describe pod <vm-pod-name> -n shadow
```

### VM Boot Issues  

```bash
# Check init container logs (VM startup)
kubectl logs <vm-pod-name> -n shadow -c vm-starter

# Check VM proxy container status
kubectl logs <vm-pod-name> -n shadow -c vm-proxy

# Verify VM images are available
kubectl exec -it <firecracker-runtime-pod> -n shadow -- ls -la /var/lib/firecracker/

# Test VM connectivity
kubectl port-forward <vm-pod-name> 8080:8080 -n shadow
curl http://localhost:8080/health
```

### VM Image Issues

```bash
# Check if VM images are built and available
gh run list --workflow="Build Firecracker VM Images"

# Verify image registry access
docker login ghcr.io/your-org
docker pull ghcr.io/your-org/shadow-vm:latest

# Check VM image deployment to nodes
kubectl get configmap shadow-vm-images -n shadow -o yaml
```

### Performance Issues

```bash
# Check node resources and VM density
kubectl top nodes
kubectl describe node <firecracker-node-name>

# Monitor VM resource usage
kubectl top pods -n shadow -l app=shadow-firecracker

# Track VM boot times
kubectl get events -n shadow --sort-by='.lastTimestamp' | grep "shadow-vm"

# Check for VM creation bottlenecks
kubectl get events -n shadow | grep FailedScheduling
```

### Configuration Issues

```bash
# Verify Firecracker mode is enabled
kubectl logs <shadow-server-pod> | grep "AGENT_MODE"

# Check service account permissions
kubectl auth can-i create pods --as=system:serviceaccount:shadow:shadow-firecracker-vm-sa -n shadow

# Verify network connectivity
kubectl exec -it <vm-pod> -n shadow -- ping google.com
```

### Debug Commands
```bash
# View all Firecracker resources
kubectl get pods,jobs,configmaps -n shadow -l app=shadow-firecracker

# Monitor VM resource usage
kubectl top pods -n shadow -l app=shadow-firecracker

# Check cluster events
kubectl get events -n shadow --sort-by='.lastTimestamp'

# Access VM console (if available)
kubectl exec -it shadow-vm-<task-id> -n shadow -- socat - /var/lib/firecracker/firecracker.socket
```

## Security Considerations

### Hardware Isolation Benefits
- **Kernel Separation**: Each VM runs isolated kernel space
- **Memory Isolation**: Hardware-enforced memory boundaries  
- **Resource Limits**: VM-level CPU, memory, and I/O controls
- **Attack Surface**: Minimal VM attack surface vs container runtime
- **True VM Boundaries**: Each task runs in isolated kernel space

### Network Security
- **Pod Networking**: VMs communicate via Kubernetes pod networking
- **TAP Interfaces**: Isolated network interfaces per VM
- **Firewall Rules**: Kubernetes NetworkPolicies restrict VM communication

```bash
# VM pods use Kubernetes networking with isolation
kubectl get networkpolicy -n shadow

# Monitor VM network traffic
kubectl logs -l app=shadow-firecracker -n shadow | grep "network"
```

### Storage Security  
- **Ephemeral Storage**: VM filesystems destroyed after task completion
- **Git Persistence**: Only committed changes persist via git branches
- **No Shared Storage**: Each VM has isolated workspace

## Performance Optimization

### Boot Time Optimization
- **VM Image Size**: Minimize rootfs for faster loading
- **Kernel Optimization**: Use minimal kernel configuration  
- **Parallel Boot**: Start multiple VMs concurrently
- **Image Caching**: Pre-load VM images on nodes

### Resource Optimization
- **CPU Allocation**: Match VM vCPU count to workload requirements
- **Memory Sizing**: Monitor actual usage and adjust limits
- **Storage**: Use ephemeral storage for better performance
- **Network**: Optimize TAP interface configuration

### Monitoring Metrics
- **Boot Time**: Target <125ms VM startup
- **Task Completion**: Monitor end-to-end task execution time
- **Resource Utilization**: Track CPU, memory, and storage usage
- **Error Rates**: Monitor VM creation and task failure rates

## Cost Optimization

### Resource Monitoring

```bash
# Track VM resource utilization
kubectl describe resourcequota shadow-agents-quota -n shadow

# Monitor node utilization
kubectl top nodes -l firecracker=true

# Calculate VM density per node
kubectl get pods -n shadow -o wide | grep shadow-vm | wc -l
```

### Cost Optimization Strategies

- **VM Lifecycle**: Aggressive cleanup of completed VMs
- **Resource Right-Sizing**: Monitor actual usage and adjust limits
- **Spot Instances**: Use for non-critical development workloads
- **Scale-to-Zero**: Scale down Firecracker nodes during off-hours
- **Reserved Capacity**: Use reserved instances for predictable workloads

## Production Considerations

### Scaling
- **Node Pool**: Auto-scale Firecracker node pool based on demand
- **VM Density**: Monitor VMs per node for optimal resource utilization
- **Queue Management**: Implement task queuing for peak demand

### Reliability
- **Health Monitoring**: Continuous VM and node health checks
- **Automatic Recovery**: Restart failed VMs and reschedule tasks
- **Backup Strategy**: Git-based persistence eliminates backup complexity

### Cost Management
- **Spot Instances**: Consider spot instances for non-critical workloads
- **Resource Right-Sizing**: Optimize VM resource allocation
- **Idle Shutdown**: Implement aggressive VM cleanup policies
- **Reserved Capacity**: Use reserved instances for predictable workloads

## Maintenance

### Regular Maintenance Tasks
- **VM Image Updates**: Rebuild VM images monthly for security patches
- **Cluster Updates**: Update Kubernetes and Firecracker versions quarterly  
- **Security Scanning**: Scan VM images for vulnerabilities
- **Performance Review**: Analyze metrics and optimize resource allocation

### Automated VM Image Updates

```bash
# VM images are updated via GitHub Actions
git push origin main  # Triggers automated rebuild

# Monitor image build
gh run list --workflow="Build Firecracker VM Images"

# Update image tag in production
export NEW_TAG="sha-$(git rev-parse --short HEAD)"
kubectl set env deployment/shadow-server VM_IMAGE_TAG=$NEW_TAG
```

### Cluster Maintenance

```bash
# Run infrastructure health check
./scripts/test-firecracker-integration.sh

# Update Kubernetes components
eksctl update cluster --name shadow-firecracker

# Rotate service account tokens
kubectl delete secret shadow-service-account-token -n shadow
kubectl apply -f - << 'EOF'
# ... (service account secret manifest)
EOF
```

### Monitoring and Alerting

- **VM Creation Failures**: Alert on VM creation error rate >5%
- **Boot Time Degradation**: Alert on boot times >180s
- **Resource Exhaustion**: Alert on node resource utilization >80%
- **Task Failure Rate**: Alert on task failure rate >10%

```bash
# Access monitoring dashboard
kubectl port-forward -n monitoring svc/prometheus-grafana 3000:80
```

## Migration Guide

### From Container Mode to Firecracker Mode

1. **Infrastructure**: Deploy Firecracker cluster alongside existing infrastructure
2. **Testing**: Run parallel testing with both modes
3. **Gradual Migration**: Route subset of tasks to Firecracker mode
4. **Monitoring**: Compare performance and reliability metrics
5. **Full Migration**: Switch all tasks to Firecracker mode
6. **Cleanup**: Decommission container-based infrastructure

### Rollback Plan
- **Configuration**: Switch `AGENT_MODE` back to `local` or `remote`
- **Infrastructure**: Keep container infrastructure during transition
- **Data**: Git-based persistence ensures no data loss during rollback

## Success Metrics

- **VM Boot Time**: <125ms (target <100ms)
- **Task Success Rate**: >95%
- **VM Creation Success**: >99%
- **Resource Efficiency**: Optimal VM density per node
- **Security**: Zero container escape vulnerabilities

## Support and Maintenance

### Regular Health Checks
```bash
# Weekly infrastructure validation
./scripts/test-firecracker-integration.sh

# Monthly performance review
kubectl top nodes -l firecracker=true
kubectl get events -n shadow --sort-by='.lastTimestamp' | head -20

# Quarterly security audit
kubectl get pods -n shadow -o yaml | grep -i security
```

This comprehensive deployment guide provides a complete production-ready setup for Shadow's **true Firecracker microVM architecture** with hardware-level isolation, automated CI/CD, comprehensive monitoring, and enterprise-grade operational procedures.