# Shadow Agent Dual-Mode Implementation Plan

## Overview

This document outlines the implementation plan for adding **dual-mode support** to Shadow, enabling the agent to run in both **local mode** (current implementation) and **remote mode** (distributed microVM architecture) with minimal code changes.

## Architecture Goals

- **Shared Core**: Agent logic, LLM integration, and tool definitions work identically in both modes
- **Abstracted Execution**: Tool operations abstracted behind interfaces for local vs remote execution
- **Configuration-Driven**: Mode selection via environment variables
- **Backwards Compatible**: Existing local mode continues to work unchanged
- **Incremental Migration**: Can be rolled out phase-by-phase

## Current State Analysis

### ✅ What Works in Both Modes Already

- `ChatService` - message orchestration and conversation flow
- `LLMService` - Claude/GPT API integration
- Tool definitions and system prompts
- Database schema and message persistence
- WebSocket streaming protocol
- Frontend UI components

### 🔄 What Needs Abstraction

- File system operations (read/write/delete)
- Terminal command execution
- Workspace initialization and cleanup
- Directory listing and file searching

### ➕ What Needs Adding

- Remote workspace management (Kubernetes pod orchestration)
- Sidecar communication APIs
- Tool execution routing layer
- Remote command execution via sidecar
- Configuration for dual-mode operation

## Implementation Phases

### Phase 1: Create Abstraction Layer (Week 1-2)

#### 1.1 Tool Execution Interface

Create abstraction layer for tool operations:

```
apps/server/src/execution/
├── interfaces/
│   ├── tool-executor.ts       # Core execution interface
│   ├── workspace-manager.ts   # Workspace lifecycle interface
│   └── types.ts              # Shared types
├── local/
│   ├── local-tool-executor.ts    # Current implementation
│   └── local-workspace-manager.ts # Current workspace logic
└── index.ts                  # Factory functions
```

#### 1.2 Refactor Current Tools

- Extract file operations from `tools/index.ts` into execution layer
- Update tools to use `ToolExecutor` interface instead of direct fs calls
- Maintain 100% backwards compatibility with current behavior

#### 1.3 Configuration Extension

Update `config.ts` to support mode selection:

- Add `AGENT_MODE` environment variable (`local` | `remote`)
- Add Kubernetes configuration section
- Add sidecar communication settings

### Phase 2: Remote Infrastructure (Week 3-5)

#### 2.1 Sidecar API Definition

Design and document the sidecar REST API:

```
POST /execute/command     # Run terminal command
GET  /files/{path}        # Read file contents
POST /files/{path}        # Write file contents
DELETE /files/{path}      # Delete file
GET  /directory/{path}    # List directory
POST /search/files        # File search
POST /search/grep         # Grep search
```

#### 2.2 Remote Tool Executor

Implement `RemoteToolExecutor` that communicates with sidecar:

- HTTP client for sidecar API calls
- Error handling and retry logic
- Streaming support for large file operations
- Connection pooling and keepalive

#### 2.3 Kubernetes Pod Manager

Implement pod lifecycle management:

- Pod creation with Firecracker + sidecar containers
- Health checking and readiness detection
- Resource allocation and limits
- Pod cleanup and garbage collection

### Phase 3: Sidecar Implementation (Week 6-8)

#### 3.1 Sidecar Service

Create the sidecar container application:

```
apps/sidecar/
├── src/
│   ├── api/              # REST API handlers
│   ├── vm/               # MicroVM communication
│   ├── filesystem/       # EFS/workspace management
│   ├── terminal/         # Console I/O streaming
│   └── health/           # Health checks
├── Dockerfile
└── kubernetes/
    ├── deployment.yaml
    └── service.yaml
```

#### 3.2 MicroVM Integration

- Firecracker VM lifecycle management
- Serial console I/O bridging
- Workspace mounting (EFS/NFS)
- Network configuration for VM

#### 3.3 Terminal Streaming

- In-memory circular buffers for console output
- WebSocket connection to backend for real-time streaming
- Command injection into VM console
- Session management and reconnection

### Phase 4: Remote Mode Integration (Week 9-10)

#### 4.1 Remote Workspace Manager

Implement Kubernetes-based workspace management:

- Pod creation for new tasks
- Workspace initialization (repo cloning)
- Sidecar endpoint discovery
- Cleanup orchestration

#### 4.2 Agent Factory Updates

Update agent creation to support mode selection:

- Environment-based factory selection
- Dependency injection for workspace managers
- Configuration validation

#### 4.3 Error Handling & Resilience

- Pod failure detection and recovery
- Sidecar communication timeouts
- Graceful degradation strategies
- Comprehensive logging and metrics

### Phase 5: Testing & Validation (Week 11-12)

#### 5.1 Unit Tests

- Test tool executor implementations
- Mock sidecar for testing remote executor
- Workspace manager unit tests
- Configuration validation tests

#### 5.2 Integration Tests

- End-to-end local mode testing
- End-to-end remote mode testing (with test cluster)
- Mode switching tests
- Concurrent task handling

#### 5.3 Performance Testing

- Latency comparison (local vs remote)
- Resource utilization benchmarks
- Scaling tests with multiple pods
- Memory leak detection

## Detailed Component Design

### Tool Executor Interface

```typescript
interface ToolExecutor {
  // File operations
  readFile(path: string, options?: ReadFileOptions): Promise<FileResult>;
  writeFile(path: string, content: string): Promise<WriteResult>;
  deleteFile(path: string): Promise<DeleteResult>;
  listDirectory(path: string): Promise<DirectoryListing>;

  // Search operations
  searchFiles(
    query: string,
    options?: SearchOptions
  ): Promise<FileSearchResult>;
  grepSearch(pattern: string, options?: GrepOptions): Promise<GrepResult>;

  // Command execution
  executeCommand(
    command: string,
    options?: CommandOptions
  ): Promise<CommandResult>;

  // Workspace management
  getWorkspacePath(): string;
  isRemote(): boolean;
}
```

### Workspace Manager Interface

```typescript
interface WorkspaceManager {
  prepareWorkspace(task: TaskConfig): Promise<WorkspaceInfo>;
  cleanupWorkspace(taskId: string): Promise<void>;
  getWorkspaceStatus(taskId: string): Promise<WorkspaceStatus>;

  // Remote-specific
  getExecutor(taskId: string): Promise<ToolExecutor>;
  healthCheck(taskId: string): Promise<HealthStatus>;
}
```

### Configuration Schema

```typescript
interface AgentConfig {
  mode: "local" | "remote";

  local: {
    workspaceDir: string;
    maxConcurrentTasks: number;
  };

  remote: {
    kubernetes: {
      namespace: string;
      podTemplate: string;
      resourceLimits: ResourceConfig;
    };
    sidecar: {
      image: string;
      port: number;
      healthCheckPath: string;
    };
    storage: {
      efsVolumeId?: string;
      s3Bucket?: string;
    };
  };
}
```

## Migration Strategy

### Development Environment

1. **Week 1-2**: Developers work on abstraction layer in feature branches
2. **Week 3-5**: Set up local Kubernetes cluster (minikube/kind) for testing
3. **Week 6-8**: Sidecar development with integration tests
4. **Week 9-10**: End-to-end remote mode testing

### Staging Environment

1. Deploy remote mode to staging cluster
2. Run parallel testing (same tasks in local and remote modes)
3. Performance and reliability validation
4. User acceptance testing

### Production Rollout

1. **Phase 1**: Deploy remote infrastructure (no traffic)
2. **Phase 2**: Enable remote mode for internal users only
3. **Phase 3**: Gradual rollout to external users (10%, 50%, 100%)
4. **Phase 4**: Local mode remains available as fallback

## Testing Strategy

### Automated Testing

- **Unit tests**: Mock all external dependencies
- **Integration tests**: Test against real Kubernetes cluster
- **Performance tests**: Benchmark both modes
- **Chaos testing**: Pod failures and network issues

### Manual Testing

- **Developer workflow**: Local development with both modes
- **User scenarios**: Complex multi-file coding tasks
- **Edge cases**: Large repositories, long-running tasks
- **Failure scenarios**: Pod crashes, network interruptions

## Security Considerations

### Local Mode Security

- Maintain current workspace isolation
- Process-level sandboxing
- File system permissions

### Remote Mode Security

- Firecracker microVM isolation
- Network policies for pod communication
- Secrets management for API keys
- EFS access controls

## Monitoring & Observability

### Metrics

- Task execution latency (local vs remote)
- Pod startup time and success rate
- Sidecar communication errors
- Resource utilization per mode

### Logging

- Structured logging with task correlation
- Agent decision audit trail
- Tool execution traces
- Performance timing logs

### Alerting

- Pod startup failures
- Sidecar communication timeouts
- Resource exhaustion
- Security policy violations

## Risk Mitigation

### Technical Risks

- **Complexity increase**: Mitigated by maintaining local mode as simple fallback
- **Performance degradation**: Addressed through comprehensive benchmarking
- **Network failures**: Handled with retry logic and graceful degradation

### Operational Risks

- **Deployment complexity**: Phased rollout with extensive testing
- **Resource costs**: Monitoring and auto-scaling policies
- **Security vulnerabilities**: Regular security audits and updates

## Success Criteria

### Functional Requirements

- ✅ Both modes execute identical tasks with same results
- ✅ No breaking changes to existing local mode
- ✅ Remote mode handles concurrent tasks reliably
- ✅ Tool operations have <500ms latency overhead in remote mode

### Non-Functional Requirements

- ✅ 99.9% task completion rate in remote mode
- ✅ <10 second pod startup time
- ✅ Graceful handling of pod failures
- ✅ Resource usage stays within 2x of local mode

## Timeline Summary

| Phase   | Duration   | Key Deliverables                            |
| ------- | ---------- | ------------------------------------------- |
| Phase 1 | Week 1-2   | Abstraction layer, refactored tools         |
| Phase 2 | Week 3-5   | Remote infrastructure, sidecar API          |
| Phase 3 | Week 6-8   | Sidecar implementation, microVM integration |
| Phase 4 | Week 9-10  | Remote mode integration, testing            |
| Phase 5 | Week 11-12 | Validation, performance tuning              |

**Total Duration**: ~3 months for full implementation and validation

## Next Steps

1. **Team assignment**: Assign developers to each phase
2. **Environment setup**: Provision development Kubernetes clusters
3. **Dependency analysis**: Identify any missing infrastructure components
4. **Stakeholder alignment**: Review plan with product and infrastructure teams
5. **Risk assessment**: Detailed analysis of technical and operational risks

---

_This plan provides a roadmap for implementing dual-mode support while maintaining system reliability and developer productivity throughout the transition._
