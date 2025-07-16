# Basic Usage Examples

This document shows common usage patterns for the Shadow Coding Agent.

## Setup

```bash
# From the root of the monorepo
cd apps/coding-agent
cp .env.example .env

# Edit .env with your API key
echo 'ANTHROPIC_API_KEY=your_key_here' >> .env
```

## Simple File Operations

### Create a new utility function

```bash
npm run dev "Create a utility function in packages/utils/src/format.ts that formats dates in a human-readable way"
```

### Add types to an existing package

```bash
npm run dev "Add TypeScript types for a User interface in packages/types/src/index.ts with fields: id, name, email, createdAt"
```

## Component Development

### Create a React component

```bash
npm run dev "Create a Button component in apps/frontend/components/ui/button.tsx with variants for primary, secondary, and danger styles"
```

### Add a new page

```bash
npm run dev "Create a new profile page at apps/frontend/app/profile/page.tsx that displays user information"
```

## API Development

### Create an Express route

```bash
npm run dev "Add a /api/users endpoint to apps/server/src/app.ts that returns a list of users from the database"
```

### Add middleware

```bash
npm run dev "Create authentication middleware in apps/server/src/middleware/auth.ts that verifies JWT tokens"
```

## Database Operations

### Add a new Prisma model

```bash
npm run dev "Add a Post model to packages/db/prisma/schema.prisma with fields: id, title, content, authorId, createdAt, updatedAt"
```

### Create database operations

```bash
npm run dev "Create CRUD operations for the User model in packages/db/src/users.ts"
```

## Testing

### Add unit tests

```bash
npm run dev "Create unit tests for the user service functions in apps/server/src/__tests__/user.test.ts"
```

### Add integration tests

```bash
npm run dev "Create integration tests for the /api/auth endpoints using Jest and supertest"
```

## Configuration and Setup

### Environment configuration

```bash
npm run dev "Add environment variable validation using Zod in apps/server/src/config/env.ts"
```

### Docker setup

```bash
npm run dev "Create a Dockerfile for the server app with multi-stage build and proper Node.js setup"
```

## Complex Tasks

### Feature implementation

```bash
npm run dev "Implement user authentication flow with login, register, and logout endpoints, including JWT token management and password hashing"
```

### Code refactoring

```bash
npm run dev "Refactor the database connection logic in apps/server to use a proper connection pool and error handling"
```

## Planning Mode

Use the `plan` command to see what the agent would do without executing:

```bash
# Plan a complex task
npm run dev plan "Implement a real-time chat system with WebSocket support, message persistence, and user presence"

# Plan API changes
npm run dev plan "Add pagination, filtering, and sorting to the users API endpoint"
```

## Working with Existing Code

### Bug fixes

```bash
npm run dev "Fix the CORS issue in apps/server/src/app.ts that's preventing frontend requests"
```

### Performance improvements

```bash
npm run dev "Optimize the database queries in the users service to reduce N+1 query problems"
```

### Security improvements

```bash
npm run dev "Add input validation and sanitization to all API endpoints in apps/server"
```

## Best Practices for Task Descriptions

### ✅ Good Examples

- **Specific and actionable**: "Add error handling to the login function in apps/server/src/auth.ts"
- **Clear context**: "Create a React hook for managing shopping cart state in apps/frontend/hooks/useCart.ts"
- **Includes constraints**: "Implement password hashing using bcrypt with a salt rounds of 12"

### ❌ Avoid These

- **Too vague**: "Fix the app"
- **Too complex**: "Build a complete e-commerce platform with payments, inventory, and admin panel"
- **Missing context**: "Add authentication" (where? what type? what requirements?)

## Troubleshooting

### Agent doesn't find relevant code

Try being more specific about file locations:

```bash
# Instead of: "fix the user authentication"
npm run dev "Fix the JWT token validation in apps/server/src/middleware/auth.ts"
```

### Tool execution failures

Check that you have the necessary permissions and tools installed:

```bash
# Test basic commands work
ls -la
git status
npm --version
```

### API rate limits

If you hit rate limits, try:

1. Using shorter, more focused task descriptions
2. Using the `plan` command first to see what the agent will do
3. Breaking large tasks into smaller ones