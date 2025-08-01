# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Common Commands

**Development:**
```bash
# Install dependencies
npm install

# Start all apps in development (DO NOT RUN - causes chat to hang)
# turbo dev

# Run specific app
turbo dev --filter=frontend
turbo dev --filter=server

# Build all apps
turbo build

# Lint and format
turbo lint
npm run format

# Type checking
turbo check-types
```

**Database:**
```bash
# Generate Prisma types
npm run generate

# Push schema changes
npm run db:push

# Open Prisma Studio
npm run db:studio

# Database migrations
npm run db:migrate:dev
npm run db:migrate:deploy
```

**Docker Commands:**
```bash
# Build and run all services with Docker Compose
npm run docker:build
npm run docker:up

# Build individual services  
npm run docker:server    # Backend server
npm run docker:sidecar   # Sidecar service for Firecracker mode

# Individual Docker operations
npm run docker:down      # Stop all services
npm run docker:logs      # View logs

# Alternative individual builds
docker build -f apps/server/Dockerfile -t shadow-server .
docker build -f apps/sidecar/Dockerfile -t shadow-sidecar .

# Run with docker-compose
docker-compose up -d     # Start all services
docker-compose down      # Stop all services
docker-compose logs -f   # Follow logs
```

## Architecture Overview

This is a Turborepo monorepo for Shadow - an AI coding agent platform that allows users to submit GitHub repositories and natural language instructions to have AI agents perform coding tasks in isolated execution environments.

### Core Components

**Apps:**
- `frontend/` - Next.js application with real-time chat interface, terminal emulator, and task management
- `server/` - Node.js orchestrator handling LLM integration, WebSocket communication, and API endpoints
- `sidecar/` - Express.js service providing REST APIs for file operations within Firecracker VMs
- `indexing/` - Code embedding and semantic search system (optional)

**Packages:**
- `db/` - Prisma schema and PostgreSQL client
- `types/` - Shared TypeScript type definitions
- `eslint-config/` & `typescript-config/` - Shared configurations
- `command-security/` - Security utilities for command validation

### Execution Modes

The system supports two primary execution modes via an abstraction layer:

1. **Local Mode** (Development): Direct filesystem execution on the host machine
2. **Firecracker Mode** (Production): Hardware-isolated execution in Firecracker microVMs

**Mode Selection:**
- Development: Local mode (fast iteration, direct file access)
- Production: Firecracker mode (true isolation, security, scalability)
- Configuration via `NODE_ENV` and `AGENT_MODE` environment variables

### Key Data Flow

1. **Task Initialization**: User creates task with GitHub repo, branch, and instructions
2. **Workspace Setup**: System clones repository into isolated workspace (local directory or VM)
3. **Agent Session**: Real-time chat interface with LLM streaming responses and tool execution
4. **Git Integration**: All changes committed to shadow branch with proper authorship
5. **Cleanup**: Resources cleaned up after task completion

### Database Schema (PostgreSQL + Prisma)

**Core Models:**
- `Task` - Task metadata, repository info, status, workspace paths
- `ChatMessage` - Conversation history with structured parts (text, tool-call, tool-result)
- `Todo` - Task management within sessions
- `TerminalCommand` - Command execution history
- `TaskSession` - VM/pod session tracking for Firecracker mode
- `User/Account/Session` - Authentication via Better Auth

**Message Storage Architecture:**
- Streaming messages saved incrementally with sequence ordering
- Rich metadata including token usage, finish reasons, tool execution details
- Structured parts system supporting text content, tool calls, and results

## Agent Execution System

### Initialization Engine (`apps/server/src/initialization/`)

**TaskInitializationEngine** orchestrates task setup with mode-specific steps:

**Local Mode Steps:**
- `PREPARE_WORKSPACE` - Create local directory and clone repository

**Firecracker Mode Steps:**
- `CREATE_VM` - Create Firecracker VM pod in Kubernetes
- `WAIT_VM_READY` - Wait for VM boot and sidecar service health
- `VERIFY_VM_WORKSPACE` - Confirm repository cloned and workspace ready

**Real-time Progress:** WebSocket events stream initialization progress to frontend

### Execution Abstraction Layer (`apps/server/src/execution/`)

**Factory Pattern:** Mode-agnostic tool execution through common interfaces
```typescript
// Automatically selects local or firecracker mode based on config
const executor = createToolExecutor(taskId, workspacePath);
const workspaceManager = createWorkspaceManager();
```

**Key Interfaces:**
- `ToolExecutor` - File operations, command execution, code search
- `WorkspaceManager` - Workspace lifecycle, health checks, cleanup

**Local Implementation:**
- Direct filesystem operations via Node.js APIs
- Command execution through child processes
- File watching for real-time updates

**Firecracker Implementation:**
- HTTP API calls to sidecar service within Kata Container VMs
- Kubernetes pod management with kata-fc RuntimeClass
- VM lifecycle orchestration via Kata Containers runtime

### Tool System (`apps/server/src/tools/`)

**Available Tools:**
- `read_file` - Read file contents with line range support
- `edit_file` - Write/modify files with change tracking
- `search_replace` - Precise string replacement in files
- `list_dir` - Directory listing and exploration
- `run_terminal_cmd` - Command execution with real-time output
- `grep_search` - Pattern matching with regex support
- `file_search` - Fuzzy filename search
- `semantic_search` - AI-powered semantic code search
- `todo_write` - Structured task management
- `delete_file` - File deletion with safety checks

**Tool Context:**
- Each tool scoped to task-specific workspace
- Real-time output streaming via WebSocket
- Automatic file change tracking and git commits
- Security isolation (path traversal protection)

### LLM Integration (`apps/server/src/llm.ts`)

**Multi-Provider Support:**
- Anthropic Claude (Claude-3.5-Sonnet, Claude-3-Haiku)
- OpenAI (GPT-4o, GPT-4o-mini)
- Unified streaming interface via Vercel AI SDK

**Streaming Architecture:**
- Real-time token streaming to frontend
- Tool call/result lifecycle management
- Automatic message persistence with structured parts
- Usage tracking and analytics

### Real-time Communication (`apps/server/src/socket.ts`)

**WebSocket Events:**
- `user-message` - Initiates LLM processing
- `stream-chunk` - Real-time content, tool calls, file changes
- `terminal-output` - Command execution output
- `task-status-updated` - Status transitions
- `init-progress` - Initialization step updates

**Connection Management:**
- Task-based room isolation
- Reconnection handling with state recovery
- Heartbeat/keepalive for connection health

### Git Integration (`apps/server/src/services/git-manager.ts`)

**Shadow Branch Workflow:**
- Each task creates isolated shadow branch (e.g., `shadow/task-abc123`)
- Automatic commits after LLM responses with proper co-authorship
- AI-generated commit messages based on file diffs
- Push to remote for persistence and collaboration

**Commit Attribution:**
- Primary author: GitHub user who created the task
- Co-author: Shadow AI agent for transparency

## Security & Isolation

### Firecracker MicroVMs

**Hardware-Level Isolation:**
- True VM isolation via Firecracker hypervisor
- Minimal attack surface with purpose-built kernel
- Resource limits (CPU, memory, storage)
- Network isolation with controlled egress

**Sidecar Architecture:**
- Express.js API service within each VM
- Path traversal protection
- Workspace boundary enforcement
- Secure file operations and command execution

### Local Mode Security

**Workspace Isolation:**
- Operations restricted to task-specific directories
- Path validation and sanitization
- File system watching for unauthorized changes

## Infrastructure & Deployment

### Firecracker Infrastructure (Production)

**EKS Cluster Configuration:**
- AWS EKS with Amazon Linux 2023 nodes (required for glibc 2.34 compatibility)
- Bare metal instances (c5.metal) for nested virtualization support
- Kata Containers + Firecracker for VM-level isolation
- GitHub Container Registry integration for VM images

**Deployment Scripts:**
```bash
# Deploy full EKS cluster with Firecracker support
./scripts/deploy-firecracker-infrastructure.sh

# Deploy ECS backend + Firecracker infrastructure  
./scripts/deploy-full-infrastructure.sh

# Build and deploy VM images via GitHub Actions
# Triggered by: .github/workflows/build-vm-images.yml
```

**Infrastructure Components:**
- **EKS Control Plane**: Kubernetes API and scheduling
- **Firecracker Nodes**: c5.metal instances with KVM/nested virtualization
- **System Nodes**: m5.large instances for cluster services
- **VM Image Registry**: GitHub Container Registry (ghcr.io)
- **Kata Containers**: Runtime for Firecracker VM orchestration

### Kubernetes Integration (Firecracker Mode)

**Pod Management:**
- Dynamic VM pod creation for each task using `kata-fc` RuntimeClass
- Resource allocation and limits per Firecracker VM
- Health monitoring and automatic cleanup
- Service discovery for sidecar communication within VMs

**VM Configuration:**
```yaml
# Pod template with Firecracker runtime
spec:
  runtimeClassName: kata-fc
  nodeSelector:
    firecracker: "true"
  tolerations:
  - key: firecracker.shadow.ai/dedicated
    value: "true"
    effect: NoSchedule
  containers:
  - name: sidecar
    resources:
      limits:
        cpu: "2"
        memory: "4Gi"
        storage: "10Gi"
```

### Docker Support

**Multi-Service Architecture:**
- Frontend: Next.js application
- Server: Node.js API and orchestrator
- Sidecar: File operations service for VMs
- Database: PostgreSQL with connection pooling

**Development Environment:**
```bash
docker-compose up -d  # Full stack locally
```

## Authentication & GitHub Integration

**Better Auth Integration:**
- GitHub OAuth for user authentication
- GitHub App installation for repository access
- Token management with refresh handling
- Repository permission validation

**GitHub API Usage:**
- Repository cloning with user credentials
- Branch creation and management
- Commit and push operations
- Installation webhook handling

## Development Practices

### Environment Setup
- Local mode for development (fast iteration)
- Docker Compose for full stack testing
- Kubernetes for production Firecracker deployment

### Code Organization
- Turborepo monorepo with shared packages
- TypeScript throughout with strict type checking
- Shared configurations and utilities
- Clean separation between execution modes

### Important Notes
- Do NOT run npm run dev anywhere
- Always test both local and Firecracker modes for production features
- Keep initialization steps mode-aware and properly abstracted
- Maintain WebSocket event compatibility across frontend/backend changes
- **Firecracker mode requires Amazon Linux 2023 nodes** for Kata Containers compatibility
- Use `kata-fc` RuntimeClass for Firecracker VM isolation, not direct firecracker runtime

### Maintenance Guidelines
- Update CLAUDE.md when making architectural changes
- Keep README.md current with setup instructions
- Avoid documenting implementation details that change frequently
- Focus on high-level architecture and key integration points