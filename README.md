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
NEXT_PUBLIC_API_URL=localhost:4000
NEXT_PUBLIC_SOCKET_URL=localhost:4001

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

```
psql "DROP DATABASE shadow_dev; CREATE DATABASE shadow_dev;"
```

We're using [Prisma](https://www.prisma.io/) as our ORM.

To generate types from the schema, run:

```
npm run generate
```

Since we're constantly making schema changes, you can just directly push to the database:

```
npm run db:push
```

To run the Prisma Studio GUI, you can run:

```
npm run db:studio
```

### Local Workspace Terminal Agent

The coding agent can be run locally in the terminal for testing on a local workspace.

First, create a local workspace directory, we have a script to make one for you:

```
./create-local-workspace.sh
```

Ensure you set the absolute path of the workspace in the server's .env file:

```
WORKSPACE_DIR=...
```

Then, run the terminal agent:

```
cd apps/server
npm run validate
npm run agent
```
