# Shadow Monorepo

This project uses [Turborepo](https://turborepo.com/docs) to manage its dependencies.

## Apps and Packages

**Apps:**

- `frontend`: Next.js app (UI, chat, terminal, task flows)
- `server`: Node.js backend (orchestrator, API, LLM, sockets)
- `indexing`: Code embedding/indexing tools (Pinecone, chunking, retrieval)

**Packages:**

- `db`: Prisma/Postgres client & schema
- `types`: Shared TypeScript types
- `eslint-config`: Shared lint rules
- `typescript-config`: Shared tsconfig

```
.
├── apps/
│   ├── frontend/
│   └── server/
├── packages/
│   ├── db/
│   ├── eslint-config/
│   ├── types/
│   └── typescript-config/
└── research/
```

## Development

Install dependencies:

```
npm install
```

Fill out environment variables:

**apps/frontend/.env.local**

```
NEXT_PUBLIC_API_URL=http://localhost:4000
NEXT_PUBLIC_SOCKET_URL=http://localhost:4001

BETTER_AUTH_SECRET=
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
```

**apps/server/.env**
Note: The database URL is only needed here if you want to run the terminal agent for local workspace testing. Use the same values as the DB package, see the next section for more details.

```
ANTHROPIC_API_KEY=
OPENAI_API_KEY=

WORKSPACE_DIR=
DEBUG=

DATABASE_URL=
```

**packages/db/.env**

```
DATABASE_URL=
```

To develop all apps and packages, ensure you have [turbo installed globally](<(https://turborepo.com/docs/getting-started/installation#global-installation)>).

Then run the following command:

```
cd my-turborepo

turbo dev
```

You can develop a specific package by using a [filter](https://turborepo.com/docs/crafting-your-repository/running-tasks#using-filters):

```
turbo dev --filter=frontend
```

### Linting and formatting

Ensure you have ESLint and Prettier installed for linting and formatting (and also format on save in VSCode settings). You can run these scripts from the project root:

```
npm run lint

npm run format
```

### Database

Set up a local Postgres database for development. Ensure you have Postgres installed and running ([Postgres.app on Mac](https://postgresapp.com/) is easy).

```bash
psql -U postgres -c "CREATE DATABASE shadow_dev;"
```

Then update your `packages/db/.env` with:

```
DATABASE_URL="postgres://postgres:@127.0.0.1:5432/shadow_dev"
```

To re-set up the database, run:

```bash
psql "DROP DATABASE shadow_dev; CREATE DATABASE shadow_dev;"
```

We're using [Prisma](https://www.prisma.io/) as our ORM.

To generate types from the schema, run:

```bash
npm run generate
```

Since we're constantly making schema changes, you can just directly push to the database:

```bash
npm run db:push
```

To run the Prisma Studio GUI, you can run:

```
npm run db:studio
```

## Docker Development

For containerized development, use Docker Compose:

```bash
# Start all services
docker-compose up -d

# Stop services:
docker-compose down
```

## Production Deployment

Shadow supports multiple deployment options depending on your infrastructure needs:

### Deployment Scripts Overview

- **`deploy-firecracker-infrastructure.sh`** - Deploys only the EKS cluster with Firecracker/Kata Containers for VM isolation
- **`deploy-backend-ecs.sh`** - Deploys only the Shadow backend service on ECS with ALB
- **`deploy-full-infrastructure.sh`** - Deploys complete infrastructure (combines both scripts above)

### Firecracker Mode (AWS EKS + Kata Containers)

Deploy VM-isolated execution environment on AWS:

```bash
# 1. Configure AWS SSO
aws configure sso --profile=ID

# 2. Deploy infrastructure (25-35 minutes)
./scripts/deploy-firecracker-infrastructure.sh

# 3. Deploy Shadow application
npm run start:prod
```

**Requirements:**
- AWS CLI configured with `ID` profile
- `eksctl`, `kubectl`, `helm` installed
- GitHub Container Registry access

**What this deploys:**
- EKS cluster with Amazon Linux 2023 nodes
- Kata Containers with QEMU runtime for VM isolation
- VM images deployed to cluster nodes
- Network policies and RBAC for security

### Full Infrastructure (EKS + ECS)

Deploy complete Shadow platform with both Firecracker cluster and backend service:

```bash
# 1. Configure AWS SSO
aws configure sso --profile=ID

# 2. Deploy full infrastructure (35-45 minutes)
./scripts/deploy-full-infrastructure.sh
```

**What this deploys:**
- Complete Firecracker infrastructure (from above)
- ECS backend service with Application Load Balancer
- Complete Shadow platform ready for production use
