# Shadow Coding Agent

A powerful AI-powered coding assistant built with the AI SDK that can help with software development tasks. This agent can explore codebases, read and write files, execute terminal commands, and implement complex coding tasks autonomously.

## Features

- **Semantic Codebase Search**: Understand and explore codebases using semantic search
- **File Operations**: Read, write, edit, and delete files with context awareness  
- **Terminal Execution**: Run commands and scripts with proper error handling
- **Multi-Provider Support**: Works with Anthropic Claude and OpenAI GPT models
- **Streaming Responses**: Real-time output with tool execution visibility
- **Task Planning**: Create detailed execution plans before implementation
- **Workspace Awareness**: Understands monorepo structure and follows existing patterns

## Installation

```bash
# Install dependencies (from root of monorepo)
npm install

# Navigate to coding agent
cd apps/coding-agent

# Copy environment template
cp .env.example .env

# Edit .env with your API keys
```

## Configuration

Set your API keys in the `.env` file:

```bash
# Choose your provider
LLM_PROVIDER=anthropic  # or 'openai'

# Set the appropriate API key
ANTHROPIC_API_KEY=your_key_here
# OR
OPENAI_API_KEY=your_key_here
```

## Usage

### Execute a Coding Task

```bash
npm run dev "Create a simple Express.js API with a /health endpoint"
```

### Plan a Task (without execution)

```bash
npm run dev plan "Implement user authentication with JWT tokens"
```

### Examples

```bash
# File operations
npm run dev "Add TypeScript types for the user model in packages/types"

# Feature implementation  
npm run dev "Create a new React component for displaying user profiles"

# Bug fixes
npm run dev "Fix the authentication middleware to handle expired tokens properly"

# Code refactoring
npm run dev "Refactor the database connection logic to use a singleton pattern"

# Testing
npm run dev "Add unit tests for the user service functions"
```

## Available Tools

The agent has access to these tools:

- **`codebase_search`**: Semantic search to find relevant code
- **`read_file`**: Read file contents with line range support
- **`edit_file`**: Create or edit files with context-aware changes
- **`run_terminal_cmd`**: Execute shell commands with proper error handling
- **`list_dir`**: Explore directory structures
- **`file_search`**: Find files by name using fuzzy matching
- **`grep_search`**: Search for text patterns using regex
- **`delete_file`**: Remove files safely

## How It Works

1. **Task Understanding**: The agent analyzes your request to understand the requirements
2. **Codebase Exploration**: Uses semantic search and file operations to understand the current state
3. **Planning**: Creates a step-by-step approach (visible with the `plan` command)
4. **Implementation**: Executes the plan using the available tools
5. **Validation**: Tests changes when possible and follows existing patterns

## Architecture

```
apps/coding-agent/
├── src/
│   ├── agent.ts         # Main CodingAgent class
│   ├── config.ts        # Configuration and system prompt
│   ├── index.ts         # CLI entry point
│   └── tools/
│       └── index.ts     # AI SDK tool definitions
├── package.json
├── tsconfig.json
├── .env.example
└── README.md
```

## Integration with AI SDK

This coding agent is built using the [AI SDK](https://sdk.vercel.ai/) which provides:

- **Structured Tool Calling**: Type-safe tool definitions with Zod schemas
- **Streaming Support**: Real-time response streaming with tool execution
- **Multi-Provider Support**: Seamless switching between LLM providers
- **Robust Error Handling**: Graceful handling of API failures and tool errors

## Development

### Building

```bash
npm run build
```

### Running in Development

```bash
npm run dev "your task here"
```

### Type Checking

```bash
npm run check-types
```

### Linting

```bash
npm run lint
```

## Best Practices

### Writing Good Task Descriptions

- Be specific about what you want to achieve
- Provide context about the current state if relevant
- Mention any constraints or requirements
- Include file paths or specific areas of focus when relevant

### Examples of Good Task Descriptions

```bash
# Good: Specific with context
"Add error handling to the user registration endpoint in apps/server/src/auth.ts"

# Good: Clear feature request
"Create a new React hook for managing user authentication state in the frontend"

# Avoid: Too vague
"Fix the bugs"

# Avoid: Too complex (split into multiple tasks)
"Implement user auth, add a dashboard, fix all TypeScript errors, and deploy to production"
```

## Troubleshooting

### API Key Issues

If you see API key errors:

1. Ensure your `.env` file is properly configured
2. Verify your API key is valid and has sufficient credits
3. Check that `LLM_PROVIDER` matches your chosen provider

### Tool Execution Failures

- File permission issues: Ensure the agent has read/write access to the workspace
- Command failures: Check that required tools (git, grep, etc.) are installed
- Path issues: Verify file paths are relative to the workspace root

### Common Error Messages

- `"No API key found"`: Set the appropriate environment variable
- `"Command failed"`: Check terminal command syntax and permissions
- `"File not found"`: Verify file paths are correct and files exist

## Contributing

This agent is part of the Shadow monorepo. To contribute:

1. Follow the existing TypeScript patterns
2. Add comprehensive error handling for new tools
3. Test tools thoroughly before submitting
4. Update documentation for new features

## License

Part of the Shadow project.