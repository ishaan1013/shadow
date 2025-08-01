# Execution Abstraction Layer

This directory contains the dual-mode execution abstraction layer that enables the coding agent to run in multiple execution environments:

- **Local Mode**: Direct filesystem operations for development
- **Firecracker Mode**: Hardware-isolated VMs on Kubernetes for production

## Architecture Overview

```
execution/
├── interfaces/           # Core interfaces and types
│   ├── tool-executor.ts     # ToolExecutor interface
│   ├── workspace-manager.ts # WorkspaceManager interface  
│   └── types.ts            # Shared type definitions
├── local/               # Local filesystem implementation
│   ├── local-tool-executor.ts     # Direct filesystem operations
│   └── local-workspace-manager.ts # Local workspace management
├── firecracker/         # Firecracker VM implementation
│   ├── firecracker-tool-executor.ts     # HTTP client for VM sidecar API
│   └── firecracker-workspace-manager.ts # Kubernetes VM lifecycle management
├── k8s/                 # Kubernetes manifests for Firecracker
│   ├── firecracker-daemonset.yaml      # Firecracker runtime deployment
│   ├── firecracker-runtime-class.yaml  # VM pod scheduling
│   ├── rbac.yaml                       # VM permissions
│   ├── namespace.yaml                  # Shadow namespace
│   ├── storage.yaml                    # Storage classes
│   └── monitoring.yaml                 # Monitoring configuration
└── index.ts            # Factory functions for mode selection
```

## Usage

### Environment Configuration

Set the agent mode using the `AGENT_MODE` environment variable:

```bash
# Local mode (default)
export AGENT_MODE=local

# Firecracker mode (requires Kubernetes with KVM support)
export AGENT_MODE=firecracker
```

### Factory Usage

```typescript
import { createToolExecutor, createWorkspaceManager } from './execution';

// Create mode-specific instances
const executor = createToolExecutor(taskId, workspacePath);
const manager = createWorkspaceManager();

// Check current mode
import { isFirecrackerMode, isLocalMode } from './execution';
```

## Configuration

### Local Mode
- `WORKSPACE_DIR`: Base directory for task workspaces
- No additional configuration required

### Firecracker Mode
- `FIRECRACKER_ENABLED`: Enable VM mode (boolean)
- `VM_IMAGE_REGISTRY`: Container registry for VM images
- `VM_IMAGE_TAG`: VM image version tag (default: "latest")
- `VM_CPU_COUNT`: vCPU count per VM (default: 1)
- `VM_MEMORY_SIZE_MB`: Memory per VM in MB (default: 1024)
- `KUBERNETES_NAMESPACE`: K8s namespace for VMs (default: "shadow")
- `VM_CPU_LIMIT`: CPU limit for VM pods (default: "1000m")
- `VM_MEMORY_LIMIT`: Memory limit for VM pods (default: "2Gi")
- `VM_STORAGE_LIMIT`: Storage limit per VM (default: "10Gi")
- `K8S_SERVICE_ACCOUNT_TOKEN`: Service account token for K8s API access

## Features

### Hardware Isolation (Firecracker Mode)
- **True VM Isolation**: Each task runs in its own Firecracker microVM
- **<125ms Boot Time**: Optimized VM startup with pre-built images
- **KVM Support**: Requires bare metal instances with `/dev/kvm` access
- **Jailer Security**: Secure VM execution with resource limits

### Error Handling & Resilience
- **Circuit breaker**: Prevents excessive retries when service is down
- **Exponential backoff**: Automatic retry with increasing delays
- **Graceful fallbacks**: Returns structured error responses instead of throwing
- **VM Recovery**: Automatic VM restart and health monitoring

### Tool Operations
Both implementations support the same set of operations:
- File operations: `readFile`, `writeFile`, `deleteFile`, `searchReplace`
- Directory operations: `listDirectory`
- Search operations: `searchFiles`, `grepSearch`, `codebaseSearch`
- Command execution: `executeCommand` (with streaming output)

### Workspace Management
- **VM Lifecycle**: Create, monitor, and cleanup Firecracker VMs
- **Health checking**: Monitor VM and sidecar service health
- **Status tracking**: Get workspace status and resource metrics
- **Git Integration**: Automatic repository cloning and shadow branch creation

## VM Image Components

### Base Image (Ubuntu 22.04 LTS)
- **Node.js 20**: JavaScript/TypeScript runtime
- **Python 3.11**: Python runtime with pip
- **LSP Servers**: typescript-language-server, pylsp
- **Development Tools**: git, curl, ripgrep, build-essential, tmux
- **Shadow Sidecar**: Pre-compiled sidecar service

### Build Process
```bash
# Build VM image
sudo ./scripts/build-vm-image.sh

# Output: vm-image/output/
# - shadow-rootfs.ext4.gz (compressed filesystem)
# - vmlinux.gz (Firecracker kernel)
# - manifest.json (build metadata)
```

## Production Deployment

### Local Mode
- Default mode, no additional setup required
- Workspaces created in `WORKSPACE_DIR/tasks/{taskId}/`

### Firecracker Mode
- **Kubernetes Requirements**:
  - Bare metal nodes with KVM support (m5.metal, c5.metal)
  - Node labels: `firecracker=true`
  - `/dev/kvm` device access
  - Privileged pod support

- **Deployment Steps**:
  ```bash
  # Deploy Kubernetes manifests
  kubectl apply -f apps/server/src/execution/k8s/
  
  # Build and push VM images
  sudo ./scripts/build-vm-image.sh
  docker tag shadow-vm:latest ${VM_IMAGE_REGISTRY}/shadow-vm:latest
  docker push ${VM_IMAGE_REGISTRY}/shadow-vm:latest
  ```

- **VM Lifecycle**:
  - Each task gets its own VM pod with isolated workspace
  - Repository automatically cloned to VM workspace
  - Shadow branch created for task-specific changes
  - Automatic cleanup when tasks complete

### Monitoring
- All operations include structured logging with `[FIRECRACKER_WM]`, `[VM_CONSOLE]`, etc. prefixes
- VM health checks and boot completion monitoring
- Resource usage tracking (CPU, memory, storage)
- Circuit breaker state changes logged

## Security Considerations

### Local Mode
- File operations scoped to workspace directory
- Command execution runs with server process permissions

### Firecracker Mode
- **Hardware Isolation**: VM-level isolation via hypervisor
- **Jailer Integration**: Secure VM execution with resource limits
- **Network Isolation**: VMs run in isolated network namespaces
- **Path Traversal Protection**: Sidecar prevents directory escape
- **Resource Limits**: CPU, memory, storage quotas per VM
- **Non-root Execution**: Workspace operations run as `shadow` user

### General
- No sensitive data logged
- GitHub tokens passed securely via environment variables
- All file paths validated and sanitized
- VM console communication uses protocol multiplexing

## Development

### Adding New Tool Operations
1. Add method to `ToolExecutor` interface in `interfaces/tool-executor.ts`
2. Implement in both `LocalToolExecutor` and `FirecrackerToolExecutor`
3. Add corresponding sidecar API endpoint for Firecracker mode

### VM Image Updates
1. Modify `vm-image/Dockerfile.vm` for new dependencies
2. Update `scripts/build-vm-image.sh` for build process changes
3. Test with `sudo ./scripts/build-vm-image.sh`
4. Update VM image tag in configuration