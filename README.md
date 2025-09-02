# Shadow

<img width="2880" height="1620" alt="cover" src="https://github.com/user-attachments/assets/69dfd5f8-0532-4515-a59e-9d43f2243ad8" />


An open-source background coding agent. Designed to understand, reason about, and contribute to existing codebases. Licensed for open-source use under MIT License

Sets up isolated execution environments for AI agents to work on GitHub repositories with tools to understand code, edit files, and much more.

### Agent Environment (The Shadow Realm)
- GitHub repository integration with branch management
- Pull request generation with AI-authored commits
- Real-time task status tracking and progress updates
- Automatic workspace setup and cleanup on Micro-VMs
- Kata QEMU containers for hardware-level isolation

### Code Generation & Understanding
- Multi-provider LLM support (Anthropic, OpenAI, OpenRouter)
- Streaming chat interface with real-time responses
- Tool execution with file operations, terminal commands, and code search
- Memory system for repository-specific knowledge retention
- Semantic code search, background processing
- Lightweight Shadow Wiki generation for comprehensive codebase documentation
- Custom rules for Shadow code generation

## Execution Modes

Shadow supports two execution modes through an abstraction layer:

### Local Mode
- Direct filesystem execution on the host machine

### Remote Mode (For Deployment)
- Hardware-isolated execution in Kata QEMU containers
- True VM isolation via QEMU hypervisor
- Kubernetes orchestration with bare metal nodes

Mode selection is controlled by `NODE_ENV` and `AGENT_MODE` environment variables.

## Development Setup

### Repository Structure

- **Frontend** (`apps/frontend/`) - Next.js application with real-time chat interface, terminal emulator, file explorer, and task management
- **Server** (`apps/server/`) - Node.js orchestrator handling LLM integration, WebSocket communication, task initialization, and API endpoints
- **Sidecar** (`apps/sidecar/`) - Express.js service providing REST APIs for file operations within isolated containers
- **Website** (`apps/website/`) - Marketing and landing page
- **Database** (`packages/db/`) - Prisma schema and PostgreSQL client with comprehensive data models
- **Types** (`packages/types/`) - Shared TypeScript type definitions for the entire platform
- **Command Security** (`packages/command-security/`) - Security utilities for command validation and sanitization
- **ESLint Config** (`packages/eslint-config/`) - Shared linting rules
- **TypeScript Config** (`packages/typescript-config/`) - Shared TypeScript configurations


### Prerequisites
- Node.js 22
- PostgreSQL

### Installation

1. Clone the repository and install dependencies:
```bash
git clone <repository-url>
cd shadow
npm install
```

2. Set up environment variables:
```bash
# Copy example environment files
cp apps/server/.env.template apps/server/.env
cp apps/frontend/.env.template apps/frontend/.env
cp packages/db/.env.template packages/db/.env
```

3. Configure the database:
```bash
# Create local PostgreSQL database
psql -U postgres -c "CREATE DATABASE shadow_dev;"

# Update packages/db/.env with your database URL
DATABASE_URL="postgres://postgres:@127.0.0.1:5432/shadow_dev"

# Generate Prisma client and push schema
npm run generate
npm run db:push
```

4. Start development servers:
```bash
# Start all services
npm run dev

# Or start specific services
npm run dev --filter=frontend
npm run dev --filter=server
npm run dev --filter=sidecar
```

### Environment Configuration

Set variables in the following files:
- Frontend: `apps/frontend/.env.local`
- Server: `apps/server/.env`
- Database: `packages/db/.env`

#### Quick start (local, no GitHub App install)
Use a personal GitHub token so the GitHub selector works instantly without installing our app.

1) Create a GitHub Personal Access Token with scopes: `repo`, `read:org`.
2) Add env vars:

An easy way to do this is run the `./setup-script.sh` which will take in your input variables and autoset them in the right places for you! If you would like to do it manually, follow the instructions below

`apps/server/.env`
```bash
# Required
DATABASE_URL="postgres://postgres:@127.0.0.1:5432/shadow_dev"
BETTER_AUTH_SECRET="dev-secret"

GITHUB_PERSONAL_ACCESS_TOKEN=ghp_xxx

# Local mode
NODE_ENV=development
AGENT_MODE=local

# Optional: Pinecone for semantic search
PINECONE_API_KEY="" # TODO: Set this to your Pinecone API key
PINECONE_INDEX_NAME="shadow"

# Workspace directory for local agent:
WORKSPACE_DIR= # TODO: Set this to your local workspace directory
```

`apps/frontend/.env.local`
```bash
# Point frontend to your server if needed
NEXT_PUBLIC_SERVER_URL=http://localhost:4000

# Marks environment; any value other than "production" enables local behavior
NEXT_PUBLIC_VERCEL_ENV=development

GITHUB_PERSONAL_ACCESS_TOKEN=ghp_xxx
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=

# Optional (only if you want OAuth login locally)
BETTER_AUTH_SECRET=dev-secret
```

`packages/db/.env`
```bash
DATABASE_URL="postgres://postgres:@127.0.0.1:5432/shadow_dev"
DIRECT_URL="postgres://postgres:@127.0.0.1:5432/shadow_dev"
```

With `GITHUB_PERSONAL_ACCESS_TOKEN` set on the server and `NEXT_PUBLIC_VERCEL_ENV` not equal to `production`, the backend uses your PAT for repo/branch/issue queries. The frontend's GitHub selector works immediately.

## Development Commands

### Linting and Formatting

```bash
# Lint all packages and apps
npm run lint

# Format code with Prettier
npm run format

# Type checking
npm run check-types
```

### Database Operations

```bash
# Generate Prisma client from schema
npm run generate

# Push schema changes to database (for development)
npm run db:push

# Reset database and push schema (destructive)
npm run db:push:reset

# Open Prisma Studio GUI
npm run db:studio

# Run migrations in development
npm run db:migrate:dev
```

### Building and Deployment

```bash
# Build all packages and apps
npm run build

# Build specific app
npm run build --filter=frontend
npm run build --filter=server
npm run build --filter=sidecar
```

## Tool System

Shadow provides a comprehensive set of tools for AI agents:

### File Operations
- `read_file` - Read file contents with line range support
- `edit_file` - Write and modify files
- `search_replace` - Precise string replacement
- `delete_file` - Safe file deletion
- `list_dir` - Directory exploration

### Code Search
- `grep_search` - Pattern matching with regex
- `file_search` - Fuzzy filename search
- `semantic_search` - AI-powered semantic code search

### Terminal & Execution
- `run_terminal_cmd` - Command execution with real-time output
- Command validation and security checks

### Task Management
- `todo_write` - Structured task management
- `add_memory` - Repository-specific knowledge storage
- `list_memories` - Retrieve stored knowledge

## Development Guidelines

### Code Organization
- TypeScript throughout with strict type checking
- Shared configurations via packages
- Clean separation between execution modes
- WebSocket event compatibility across frontend/backend

### Security
- Command validation in all execution modes
- Path traversal protection
- Workspace boundary enforcement
- Container isolation in remote mode

### Important Notes
- Always test both local and remote modes for production features
- Keep initialization steps mode-aware and properly abstracted
- Maintain WebSocket event compatibility across frontend/backend changes
- **Remote mode requires Amazon Linux 2023 nodes** for Kata Containers compatibility

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes with proper TypeScript types
4. Test in both local and remote modes
5. Submit a pull request
   
We're excited to see what you've built with Shadow!


---

[Ishaan Dey](https://ishaand.com) — [X](https://x.com/ishaandey_)

[Rajan Agarwal](https://www.rajan.sh/) — [X](https://x.com/_rajanagarwal)

[Elijah Kurien](https://www.elijahkurien.com/) — [X](https://x.com/ElijahKurien)
