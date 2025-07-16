# Shadow Coding Agent Implementation

This document provides a technical overview of the coding agent implementation using the AI SDK.

## Architecture Overview

```
apps/coding-agent/
├── src/
│   ├── index.ts         # CLI entry point with argument parsing
│   ├── agent.ts         # Main CodingAgent class with AI SDK integration
│   ├── config.ts        # Configuration management and system prompt
│   └── tools/
│       └── index.ts     # AI SDK tool definitions with Zod schemas
├── package.json         # Dependencies and scripts
├── tsconfig.json        # TypeScript configuration
├── eslint.config.js     # ESLint configuration
├── .env.example         # Environment template
├── README.md            # User documentation
└── examples/
    └── basic-usage.md   # Usage examples
```

## Key Components

### 1. Tools System (`src/tools/index.ts`)

The tools are implemented using the AI SDK's `tool()` function with Zod schemas for type safety:

```typescript
import { tool } from 'ai';
import { z } from 'zod';

export const tools = {
  codebase_search: tool({
    description: 'Semantic search for code...',
    parameters: z.object({
      query: z.string().describe('Search query'),
      // ... other parameters
    }),
    execute: async ({ query, ... }) => {
      // Implementation
    }
  }),
  // ... other tools
};
```

**Available Tools:**
- `codebase_search`: Semantic code search (currently using grep as placeholder)
- `read_file`: File reading with line range support  
- `edit_file`: File creation and editing
- `run_terminal_cmd`: Command execution with background support
- `list_dir`: Directory exploration
- `file_search`: Fuzzy file name search
- `grep_search`: Regex pattern matching
- `delete_file`: Safe file deletion

### 2. Agent Class (`src/agent.ts`)

The `CodingAgent` class integrates with the AI SDK:

```typescript
import { generateText, streamText } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { openai } from '@ai-sdk/openai';

export class CodingAgent {
  private model: any;
  
  constructor(config: AgentConfig) {
    // Initialize provider-specific model
    this.model = config.provider === 'anthropic' 
      ? anthropic(config.model)
      : openai(config.model);
  }

  async executeTask(task: CodingTask): Promise<void> {
    const { textStream } = streamText({
      model: this.model,
      system: SYSTEM_PROMPT,
      prompt: userPrompt,
      tools,
      maxTokens: this.config.maxTokens,
      temperature: this.config.temperature,
      maxToolRoundtrips: 10,
    });

    // Stream response with tool execution
    for await (const textPart of textStream) {
      process.stdout.write(textPart);
    }
  }
}
```

### 3. Configuration (`src/config.ts`)

Environment-based configuration with multi-provider support:

```typescript
export interface AgentConfig {
  provider: 'anthropic' | 'openai';
  model: string;
  apiKey: string;
  maxTokens?: number;
  temperature?: number;
  workspace: string;
}

export function getConfig(): AgentConfig {
  const provider = process.env.LLM_PROVIDER || 'anthropic';
  return {
    provider,
    model: provider === 'anthropic' ? 'claude-3-5-sonnet-20241022' : 'gpt-4o',
    apiKey: provider === 'anthropic' 
      ? process.env.ANTHROPIC_API_KEY || ''
      : process.env.OPENAI_API_KEY || '',
    // ... other config
  };
}
```

### 4. CLI Interface (`src/index.ts`)

Command-line interface with task parsing:

```typescript
#!/usr/bin/env node

async function main() {
  const config = getConfig();
  const agent = new CodingAgent(config);
  
  const args = process.argv.slice(2);
  const taskDescription = args.join(' ');
  
  const task: CodingTask = {
    description: taskDescription,
    context: 'Monorepo with Next.js frontend, Node.js server...',
    constraints: ['Follow existing patterns', 'Use TypeScript', ...]
  };

  await agent.executeTask(task);
}
```

## Integration with AI SDK

### Streaming with Tool Execution

The agent uses AI SDK's `streamText` which automatically:
- Handles tool calling during response generation
- Streams text output in real-time
- Manages conversation flow with multiple tool roundtrips
- Provides type-safe tool parameter validation

### Multi-Provider Support

Seamless switching between providers:

```bash
# Use Anthropic Claude
LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=your_key

# Use OpenAI GPT
LLM_PROVIDER=openai  
OPENAI_API_KEY=your_key
```

### Tool Schema Validation

All tools use Zod schemas for parameter validation:

```typescript
parameters: z.object({
  target_file: z.string().describe('File path'),
  should_read_entire_file: z.boolean().default(false),
  explanation: z.string().describe('Why this tool is used'),
}),
```

## Error Handling

Comprehensive error handling throughout:

1. **API Errors**: Graceful handling of rate limits, invalid keys, network issues
2. **Tool Failures**: Proper error messages for file system operations
3. **Command Failures**: Detailed stdout/stderr capture for terminal commands
4. **Validation Errors**: Zod schema validation with helpful messages

## Performance Optimizations

1. **Streaming Output**: Real-time response display
2. **Background Commands**: Support for long-running processes
3. **File Reading Limits**: Configurable line ranges to avoid large file issues
4. **Search Result Limits**: Capped results to prevent overwhelming output

## Security Considerations

1. **File System Access**: Limited to workspace directory
2. **Command Execution**: Runs in controlled environment
3. **API Key Management**: Environment variable based configuration
4. **Input Validation**: Zod schemas prevent injection attacks

## Extensibility

### Adding New Tools

```typescript
export const tools = {
  // ... existing tools
  
  new_tool: tool({
    description: 'Tool description',
    parameters: z.object({
      param: z.string().describe('Parameter description'),
    }),
    execute: async ({ param }) => {
      // Implementation
      return { result: 'success' };
    }
  }),
};
```

### Custom Providers

The architecture supports adding new LLM providers by:
1. Installing the provider SDK
2. Adding to the config provider union type
3. Updating the model initialization logic

### Enhanced Semantic Search

The current `codebase_search` uses basic text matching. It can be enhanced with:
- Vector embeddings (using `@ai-sdk/embedding`)
- Specialized code understanding models
- AST-based semantic analysis

## Testing Strategy

While not implemented yet, the architecture supports:

1. **Unit Tests**: Test individual tools and agent methods
2. **Integration Tests**: Test tool execution with real file system
3. **E2E Tests**: Test complete task execution flows
4. **Mock Testing**: Test with mocked LLM responses

## Future Enhancements

1. **Enhanced Semantic Search**: Real vector-based code search
2. **Code Context Understanding**: AST parsing for better code comprehension
3. **Multi-step Planning**: Persistent task state across sessions
4. **Collaborative Features**: Multiple agents working together
5. **IDE Integration**: VS Code extension or similar
6. **Web Interface**: Browser-based task management
7. **Task Templates**: Pre-defined templates for common tasks
8. **Learning System**: Adapt to user preferences and codebase patterns

## Dependencies

### Core Dependencies
- `ai`: AI SDK core functionality
- `@ai-sdk/anthropic`: Anthropic provider
- `@ai-sdk/openai`: OpenAI provider  
- `zod`: Schema validation
- `chalk`: Terminal colors
- `fs-extra`: Enhanced file operations
- `glob`: File pattern matching
- `simple-git`: Git operations

### Development Dependencies
- `typescript`: Type checking
- `tsx`: TypeScript execution
- `eslint`: Code linting
- Shared monorepo packages for configs

This implementation provides a solid foundation for an AI-powered coding assistant that can be extended and customized for specific development workflows.