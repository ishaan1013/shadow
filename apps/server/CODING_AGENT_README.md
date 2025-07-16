# Coding Agent Implementation

This implementation provides a fully functional coding agent with tool support using the AI SDK. The agent can perform various coding tasks including file operations, code search, terminal commands, and more.

## Architecture Overview

### Core Components

1. **LLMService** (`src/llm.ts`) - Handles AI model integration with tool support
2. **ToolExecutor** (`src/tool-executor.ts`) - Implements actual tool functionality  
3. **ChatService** (`src/chat.ts`) - Manages conversations and message history
4. **CodingAgentController** (`src/coding-agent.ts`) - API endpoints for agent interaction

### Tool System

The agent has access to 10 comprehensive tools:

- `codebase_search` - Semantic search across codebase
- `read_file` - Read file contents with line-specific ranges
- `edit_file` - Create/edit files with full content replacement
- `search_replace` - Precise text replacement in files
- `list_dir` - Directory exploration
- `file_search` - Find files by name patterns
- `grep_search` - Text search with regex support
- `run_terminal_cmd` - Execute shell commands
- `delete_file` - Safe file deletion
- `reapply` - Error recovery for failed edits

## Setup Instructions

### 1. Dependencies

All required dependencies are already installed:
```json
{
  "ai": "^4.3.19",
  "@ai-sdk/anthropic": "^1.2.12", 
  "@ai-sdk/openai": "^1.3.23",
  "zod": "^3.23.8"
}
```

### 2. Environment Variables

Set up your API keys:
```bash
# For Anthropic models
export ANTHROPIC_API_KEY="your-anthropic-key"

# For OpenAI models  
export OPENAI_API_KEY="your-openai-key"
```

### 3. Database Setup

Ensure your database schema includes the required tables (already set up in the project).

## Usage

### Starting the Server

```bash
cd apps/server
npm run dev
```

The server will start on port 3001 with the following endpoints available.

### API Endpoints

#### 1. Create a Coding Task

**POST** `/api/coding-agent/create`

```json
{
  "title": "Add authentication to user service", 
  "description": "Implement JWT-based authentication",
  "instructions": "Add authentication middleware to protect user routes. Use JWT tokens and implement login/logout functionality.",
  "modelType": "claude-3-5-sonnet-20241022"
}
```

**Response:**
```json
{
  "taskId": "uuid-here",
  "message": "Task created successfully. Use /api/coding-agent/execute to start execution."
}
```

#### 2. Execute a Task

**POST** `/api/coding-agent/execute`

```json
{
  "taskId": "uuid-from-create-response",
  "message": "Please implement the authentication system as described"
}
```

**Response:**
```json
{
  "message": "Task execution started. Monitor progress via websocket or chat history endpoint."
}
```

#### 3. Get Available Tools

**GET** `/api/coding-agent/tools`

**Response:**
```json
{
  "tools": [
    "codebase_search",
    "read_file", 
    "edit_file",
    "search_replace",
    "list_dir",
    "file_search",
    "grep_search", 
    "run_terminal_cmd",
    "delete_file",
    "reapply"
  ]
}
```

#### 4. Monitor Task Progress

**GET** `/api/tasks/{taskId}/messages`

Returns the full conversation history including tool calls and results.

### WebSocket Integration

The agent streams real-time updates via WebSocket:

```javascript
const socket = io('http://localhost:3001');

socket.on('stream-chunk', (chunk) => {
  console.log('Stream update:', chunk);
});

socket.on('stream-end', () => {
  console.log('Stream completed');
});
```

## Agent Capabilities

### Autonomous Task Execution

The agent can:
- Explore unfamiliar codebases using semantic search
- Read and analyze existing code patterns
- Make surgical edits or complete file rewrites
- Run tests and validate changes
- Execute terminal commands for building/testing
- Search for files and code patterns

### Tool Usage Patterns

The agent follows intelligent tool selection patterns:

1. **Discovery Phase**: `list_dir` → `codebase_search` → `read_file`
2. **Understanding**: Multiple `codebase_search` queries with different phrasings
3. **Planning**: Comprehensive file analysis and dependency mapping
4. **Execution**: `edit_file` → `run_terminal_cmd` (testing) → validation
5. **Verification**: Linting, testing, and manual verification

### Example Agent Workflow

For a task like "Add authentication to user service":

1. **Discovery**: Search for existing user service code
2. **Analysis**: Read current user routes and middleware
3. **Planning**: Identify files needing modification
4. **Implementation**: 
   - Create JWT middleware
   - Add authentication routes
   - Update existing routes with auth middleware
   - Create tests
5. **Validation**: Run tests and verify functionality

## Testing the Implementation

Run the test script to verify setup:

```bash
node test-agent.js
```

This validates:
- ✅ All required files exist
- ✅ Tools.json structure is correct  
- ✅ Dependencies are installed
- ✅ TypeScript compilation passes

## Advanced Features

### Custom Tool Parameters

Each tool accepts specific parameters as defined in `tools.json`. The agent automatically validates parameters using Zod schemas.

### Error Handling

- Tools return structured success/error responses
- Failed tool calls are logged and reported
- Agent can retry with different approaches

### Security Considerations

- File operations are restricted to the workspace directory
- Terminal commands have timeouts
- No network access without explicit approval
- Credentials are never exposed in logs

## Troubleshooting

### Common Issues

1. **Tool execution fails**: Check file permissions and workspace path
2. **TypeScript errors**: Run `npm run check-types` for detailed errors
3. **API key issues**: Verify environment variables are set correctly
4. **WebSocket connection**: Ensure CORS is configured properly

### Debug Mode

Enable detailed logging by setting:
```bash
export DEBUG=coding-agent:*
```

## Next Steps

To enhance the agent further:

1. **Vector Search**: Replace grep-based codebase search with semantic embeddings
2. **Git Integration**: Add tools for branch management and commits  
3. **Code Analysis**: Integrate static analysis tools
4. **Testing Framework**: Add automated test generation
5. **Deployment**: Add tools for building and deploying code

The current implementation provides a solid foundation for autonomous coding tasks while maintaining safety and reliability.