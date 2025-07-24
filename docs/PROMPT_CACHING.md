# Prompt Caching Implementation

This document describes the prompt caching implementation in the Shadow LLM service, which optimizes performance and reduces costs for both Anthropic and OpenAI providers.

## Overview

Prompt caching allows AI providers to cache and reuse portions of prompts that are frequently repeated, significantly reducing:
- **Latency**: Cached portions don't need to be reprocessed
- **Costs**: Providers often charge less for cached tokens
- **Resource Usage**: Less computational overhead for repeated content

## Implementation Details

### System Prompt Analysis

Our system prompt is approximately **14,779 characters** (~3,695 tokens), which well exceeds the minimum requirements for caching:

- **Anthropic**: 1,024 tokens minimum for Claude 3.7 Sonnet, Claude 3.5 Sonnet, and Claude 3 Opus
- **OpenAI**: 1,024 tokens minimum for automatic caching (gpt-4o, gpt-4o-mini, o1-preview, o1-mini)

### Provider-Specific Implementation

#### Anthropic Cache Control

For Anthropic models, we use explicit cache control when the system prompt exceeds 1,024 tokens:

```typescript
// Messages structure with cache control
[
  {
    role: 'system',
    content: systemPrompt,
    providerOptions: {
      anthropic: { cacheControl: { type: 'ephemeral' } },
    },
  },
  ...userMessages,
]
```

**Benefits:**
- Cache creation tokens are tracked in `providerMetadata.anthropic.cacheCreationInputTokens`
- Subsequent requests with the same system prompt benefit from caching
- Cache typically persists for 5-10 minutes of inactivity

#### OpenAI Automatic Caching

OpenAI handles prompt caching automatically for supported models when prompts are ≥1,024 tokens:

```typescript
// Standard configuration - caching is automatic
{
  model: openaiModel,
  system: systemPrompt,
  messages: userMessages,
  // ... other config
}
```

**Benefits:**
- No explicit configuration required
- Cache hits are tracked in `providerMetadata.openai.cachedPromptTokens`
- Cache persists for 5-10 minutes during normal load, up to 1 hour during off-peak

## Code Structure

### Key Components

1. **`createCachedMessages()`**: Determines whether to apply caching based on provider and prompt size
2. **Token Estimation**: Uses ~4 characters per token approximation for threshold checks
3. **Metadata Logging**: Tracks cache creation and usage statistics

### Implementation Logic

```typescript
private createCachedMessages(systemPrompt: string, messages: CoreMessage[], modelId: ModelType): CoreMessage[] {
  const provider = getModelProvider(modelId);
  const estimatedTokens = Math.round(systemPrompt.length / 4);
  
  if (provider === "anthropic" && estimatedTokens >= 1024) {
    // Apply cache control for Anthropic
    return [{ role: 'system', content: systemPrompt, providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } } }, ...messages];
  }
  
  if (provider === "openai" && estimatedTokens >= 1024) {
    // Log that automatic caching will be available
    console.log(`OpenAI automatic prompt caching available for ${estimatedTokens} tokens`);
  }
  
  return messages;
}
```

## Performance Impact

### Expected Benefits

1. **Cost Reduction**: 
   - Anthropic: Significant savings on cached tokens
   - OpenAI: Reduced costs for cached portions

2. **Latency Improvement**:
   - Faster response times for subsequent requests
   - Reduced time-to-first-token

3. **Scalability**:
   - Better handling of concurrent requests
   - Reduced computational load on providers

### Monitoring

The implementation includes logging for cache operations:

```
✅ Enabling Anthropic prompt caching for 3695 estimated tokens
✅ OpenAI automatic prompt caching will be available for 3695 estimated tokens
Anthropic cache created: 3695 tokens
OpenAI cache hit: 3695 tokens
```

## Supported Models

### Anthropic Models with Cache Control
- claude-opus-4-20250514 ✅
- claude-sonnet-4-20250514 ✅  
- claude-3-7-sonnet-20250219 ✅
- claude-3-5-sonnet-20241022 ✅
- claude-3-5-sonnet-20240620 ✅
- claude-3-5-haiku-20241022 ✅

### OpenAI Models with Automatic Caching
- gpt-4o ✅
- gpt-4o-mini ✅
- o1-preview ✅
- o1-mini ✅
- o3 ✅
- o4-mini ✅

## Configuration

No additional configuration is required. The caching implementation:

1. **Automatically detects** when prompts meet minimum token requirements
2. **Selects appropriate strategy** based on the provider
3. **Applies optimizations** transparently to the application

## Troubleshooting

### Cache Not Working

If caching doesn't appear to be working:

1. **Check prompt size**: Ensure system prompt is ≥1,024 tokens
2. **Verify model support**: Confirm the model supports caching
3. **Review logs**: Look for caching status messages in console output
4. **Check metadata**: Examine `providerMetadata` for cache statistics

### Debug Information

Enable detailed logging by checking console output for:
- Cache enablement messages
- Token estimation logs  
- Cache creation/hit statistics

## Future Improvements

1. **More Accurate Tokenization**: Replace character-based estimation with provider-specific tokenizers
2. **Cache Analytics**: Implement detailed cache hit/miss tracking
3. **Cache Strategy Optimization**: Experiment with different cache control types
4. **Dynamic Thresholds**: Adjust caching thresholds based on usage patterns

## References

- [Anthropic Cache Control Documentation](https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching)
- [OpenAI Prompt Caching Documentation](https://platform.openai.com/docs/guides/prompt-caching)
- [AI SDK Anthropic Provider](https://sdk.vercel.ai/providers/ai-sdk-providers/anthropic)
- [AI SDK OpenAI Provider](https://sdk.vercel.ai/providers/ai-sdk-providers/openai)