# Fresh AL2023 Firecracker Deployment Instructions

## Current State
✅ **Completely clean slate:**
- EKS cluster deleted
- All node groups removed
- Kubernetes contexts cleaned up
- Test resources removed

## Prerequisites Check
```bash
# Verify required tools are installed
aws --version          # AWS CLI
eksctl version         # EKS CLI
kubectl version        # Kubernetes CLI
helm version           # Helm package manager

# Verify AWS credentials
aws sts get-caller-identity --profile ID
```

## Step 1: Deploy Infrastructure with AL2023

The deployment script has been updated to use Amazon Linux 2023 for glibc 2.34 compatibility:

```bash
# Deploy EKS cluster with AL2023 nodes + Kata Containers
cd /Users/ishaandey/Documents/Programming/shadow
./scripts/deploy-firecracker-infrastructure.sh
```

**What this does:**
- Creates EKS cluster with AL2023 nodes (both firecracker + system nodes)
- Installs Kata Containers with Firecracker support
- Deploys VM images to cluster nodes
- Sets up kata-fc RuntimeClass
- Tests Firecracker VM creation

**Expected duration:** 25-35 minutes

## Step 2: Verify Deployment

```bash
# Check cluster status
kubectl get nodes -l firecracker=true

# Check Kata Containers runtime
kubectl get runtimeclass kata-fc kata-qemu

# Check VM images deployed
kubectl get pods -n shadow-agents

# Test kata-fc runtime (optional)
kubectl apply -f test-kata-fc.yaml
kubectl get pod kata-fc-test -n shadow-agents
kubectl delete pod kata-fc-test -n shadow-agents
```

## Step 3: Update Application Code

**Pod templates need minimal changes:**
```yaml
# OLD (broken):
spec:
  runtimeClassName: firecracker

# NEW (works with Kata):
spec:
  runtimeClassName: kata-fc
```

**Files to update:**
- `apps/server/src/execution/k8s/*.yaml` - Update any pod templates
- Any hardcoded references to "firecracker" RuntimeClass

## Step 4: Test End-to-End

```bash
# Set cluster configuration
source .env.production

# Test Shadow application with Firecracker mode
AGENT_MODE=remote NODE_ENV=production npm run start:server
```

## Key Changes Made

**Infrastructure:**
- ✅ Amazon Linux 2 → Amazon Linux 2023 (glibc 2.34)
- ✅ Custom firecracker runtime → Kata Containers + Firecracker
- ✅ Direct firecracker RuntimeClass → kata-fc RuntimeClass

**Application:**
- ✅ Same Shadow server/sidecar code (no changes needed)
- ✅ Same APIs and WebSocket communication
- ✅ Only RuntimeClass name changes in pod templates

## Troubleshooting

**If kata-fc RuntimeClass not found:**
```bash
kubectl get runtimeclass
kubectl logs -l name=kata-deploy -n kube-system
```

**If VM test fails:**
```bash
kubectl describe pod kata-fc-test -n shadow-agents
kubectl get events -n shadow-agents --sort-by='.lastTimestamp'
```

**If nodes not ready:**
```bash
kubectl describe nodes
kubectl get pods -n kube-system
```

## Files for Reference

**Keep these for later Kata testing:**
- `scripts/setup-devmapper.sh` - DevMapper configuration 
- `test-kata-fc.yaml` - Kata Firecracker test pod
- `test-kata-qemu.yaml` - Kata QEMU test pod

The deployment should now work with AL2023's glibc 2.34 and proper Kata Containers integration!