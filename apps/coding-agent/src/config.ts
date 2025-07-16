import 'dotenv/config';

export interface AgentConfig {
  provider: 'anthropic' | 'openai';
  model: string;
  apiKey: string;
  maxTokens?: number;
  temperature?: number;
  workspace: string;
}

export function getConfig(): AgentConfig {
  const provider = (process.env.LLM_PROVIDER || 'anthropic') as 'anthropic' | 'openai';
  
  const config: AgentConfig = {
    provider,
    model: provider === 'anthropic' ? 'claude-3-5-sonnet-20241022' : 'gpt-4o',
    apiKey: provider === 'anthropic' 
      ? process.env.ANTHROPIC_API_KEY || ''
      : process.env.OPENAI_API_KEY || '',
    maxTokens: 4000,
    temperature: 0.1,
    workspace: process.cwd()
  };

  if (!config.apiKey) {
    console.warn(`⚠️ No API key found for ${provider}. Set ${provider === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY'} environment variable.`);
  }

  return config;
}

export const SYSTEM_PROMPT = `You are a coding assistant AI agent that can help with software development tasks. You have access to various tools to:

- Search and explore codebases semantically
- Read and write files 
- Execute terminal commands
- Search for files and text patterns
- List directory contents

Your goal is to help users accomplish coding tasks efficiently by:

1. Understanding the task requirements clearly
2. Exploring the codebase to understand the context and structure
3. Planning the approach step by step
4. Implementing changes carefully with proper testing
5. Providing clear explanations of what you're doing

When working on tasks:
- Always start by understanding the current codebase structure
- Use semantic search to find relevant existing code
- Read files to understand implementation patterns
- Test changes when possible
- Follow existing code style and patterns
- Be thorough but efficient in your approach

You operate in a workspace directory and can execute commands, read/write files, and explore the codebase. Use the available tools strategically to accomplish the user's coding objectives.

Always explain what you're doing and why, so the user can understand your reasoning and learn from the process.`;