# Thinking Support in Shadow

Shadow now supports Claude's extended thinking capabilities, allowing you to see the model's reasoning process in real-time for complex problem-solving tasks.

## What is Extended Thinking?

Extended thinking gives Claude enhanced reasoning capabilities for complex tasks, while providing varying levels of transparency into its step-by-step thought process before it delivers its final answer. When enabled, Claude creates "thinking" content blocks where it outputs its internal reasoning, which is then incorporated into the final response.

## Supported Models

Extended thinking is supported in the following Claude models:

- **Claude Opus 4.1** (`claude-opus-4-1-20250805`)
- **Claude Opus 4** (`claude-opus-4-20250514`)
- **Claude Sonnet 4** (`claude-sonnet-4-20250514`)
- **Claude 3.7 Sonnet** (`claude-3-7-sonnet-20250219`)

## How to Enable Thinking

### Method 1: Default Behavior (Recommended)

Thinking is **automatically enabled** for supported Claude models by default. Simply use a supported model and thinking will be active:

```typescript
await chatService.processUserMessage({
  taskId: "task-123",
  userMessage: "Solve this complex problem step by step",
  context: taskContext,
  // thinkingConfig is optional - defaults to enabled for supported models
});
```

### Method 2: Explicit Configuration

You can explicitly control thinking settings:

```typescript
// Enable thinking with custom budget
await chatService.processUserMessage({
  taskId: "task-123",
  userMessage: "Solve this complex problem step by step",
  context: taskContext,
  thinkingConfig: {
    enabled: true,
    budgetTokens: 15000 // Custom budget (default: 10000)
  }
});

// Disable thinking
await chatService.processUserMessage({
  taskId: "task-123",
  userMessage: "Solve this complex problem step by step",
  context: taskContext,
  thinkingConfig: {
    enabled: false
  }
});
```

### Method 3: Using Utility Functions

Use the provided utility functions to check and configure thinking:

```typescript
import { 
  supportsThinking, 
  getThinkingConfig, 
  getThinkingModels 
} from "@repo/types";

// Check if a model supports thinking
const supports = supportsThinking("claude-opus-4-1-20250805");
console.log(supports); // true

// Get thinking configuration
const config = getThinkingConfig("claude-opus-4-1-20250805", true, 15000);
console.log(config); // { enabled: true, budgetTokens: 15000 }

// Get all models that support thinking
const thinkingModels = getThinkingModels();
console.log(thinkingModels); // Array of supported model IDs
```

## Configuration Options

### Thinking Configuration Object

```typescript
interface ThinkingConfig {
  enabled: boolean;        // Whether thinking should be enabled
  budgetTokens?: number;   // Token budget for thinking (default: 10000)
}
```

### Default Settings

- **Enabled**: `true` for supported models, `false` for unsupported models
- **Budget**: `10000` tokens (configurable)
- **Interleaved Thinking**: Enabled (allows thinking between tool calls)

## How It Works

### 1. Backend Processing

When thinking is enabled for a supported model:

1. The system adds the `anthropic-beta: interleaved-thinking-2025-05-14` header
2. Configures `providerOptions.anthropic.thinking` with the specified budget
3. Streams thinking chunks in real-time alongside text and tool calls

### 2. Frontend Display

Thinking parts are displayed in the chat interface:

- **Visual Style**: Blue-themed box with "Thinking" label
- **Content**: Markdown-rendered thinking content
- **Real-time**: Updates as the model thinks
- **Integration**: Seamlessly integrated with text and tool calls

### 3. Response Format

The API response includes thinking content blocks followed by text content blocks:

```json
{
  "content": [
    {
      "type": "thinking",
      "thinking": "Let me analyze this step by step...",
      "signature": "WaUjzkypQ2mUEVM36O2TxuC06KN8xyfbJwyem2dw3URve/op91XWHOEBLLqIOMfFG/UvLEczmEsUjavL...."
    },
    {
      "type": "text",
      "text": "Based on my analysis..."
    }
  ]
}
```

## Best Practices

### When to Use Thinking

- **Complex Problem Solving**: Multi-step reasoning tasks
- **Code Analysis**: Understanding and debugging complex code
- **Mathematical Problems**: Step-by-step calculations
- **Logical Reasoning**: Breaking down complex arguments
- **Tool Usage**: Planning tool calls and interpreting results

### Budget Considerations

- **Default (10,000 tokens)**: Suitable for most tasks
- **Higher budgets (15,000-20,000)**: For very complex problems
- **Lower budgets (5,000-8,000)**: For simpler reasoning tasks

### Performance Notes

- Thinking consumes additional tokens but provides better reasoning
- Interleaved thinking allows thinking between tool calls
- Supported models automatically handle thinking efficiently

## Examples

### Example 1: Complex Code Analysis

```typescript
await chatService.processUserMessage({
  taskId: "task-123",
  userMessage: "Analyze this complex algorithm and explain how it works step by step",
  context: taskContext,
  // Thinking automatically enabled for Claude models
});
```

### Example 2: Mathematical Problem Solving

```typescript
await chatService.processUserMessage({
  taskId: "task-124",
  userMessage: "Solve this calculus problem showing all steps",
  context: taskContext,
  thinkingConfig: {
    enabled: true,
    budgetTokens: 15000 // Higher budget for complex math
  }
});
```

### Example 3: Disable for Simple Tasks

```typescript
await chatService.processUserMessage({
  taskId: "task-125",
  userMessage: "What's the weather like?",
  context: taskContext,
  thinkingConfig: {
    enabled: false // Disable for simple queries
  }
});
```

## Troubleshooting

### Thinking Not Appearing

1. **Check Model**: Ensure you're using a supported Claude model
2. **Check Configuration**: Verify `thinkingConfig.enabled` is not `false`
3. **Check Budget**: Ensure `budgetTokens` is sufficient for your task
4. **Check API Keys**: Ensure Anthropic API key is valid

### Performance Issues

1. **Reduce Budget**: Lower `budgetTokens` for faster responses
2. **Disable Thinking**: Set `enabled: false` for simple tasks
3. **Use Different Model**: Try Claude 3.5 Haiku for faster responses

### Error Handling

- Unsupported models will ignore thinking configuration
- Invalid budgets will use default values
- API errors will fall back gracefully

## Technical Details

### AI SDK Integration

Shadow uses the Vercel AI SDK's built-in thinking support:

```typescript
const result = streamText({
  model: anthropic('claude-4-sonnet-20250514'),
  messages,
  headers: {
    'anthropic-beta': 'interleaved-thinking-2025-05-14',
  },
  providerOptions: {
    anthropic: {
      thinking: { type: 'enabled', budgetTokens: 10000 },
    },
  },
});
```

### Streaming Implementation

- **Backend**: Streams thinking chunks via WebSocket
- **Frontend**: Renders thinking parts in real-time
- **State Management**: Integrates with existing streaming infrastructure

### Type Safety

All thinking-related types are properly defined:

```typescript
interface ThinkingPart {
  type: "thinking";
  thinking: string;
}

interface ThinkingConfig {
  enabled: boolean;
  budgetTokens?: number;
}
```

## Conclusion

Extended thinking provides powerful reasoning capabilities for complex tasks while maintaining transparency. It's automatically enabled for supported models and can be easily configured for your specific needs. Use it to enhance problem-solving, code analysis, and complex reasoning tasks in your Shadow applications. 