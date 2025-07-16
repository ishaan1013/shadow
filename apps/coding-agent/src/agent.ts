import { generateText, streamText } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { openai } from '@ai-sdk/openai';
import chalk from 'chalk';
import { tools } from './tools';
import { AgentConfig, SYSTEM_PROMPT } from './config';

export interface CodingTask {
  description: string;
  context?: string;
  constraints?: string[];
}

export class CodingAgent {
  private config: AgentConfig;
  private model: any;

  constructor(config: AgentConfig) {
    this.config = config;
    
    // Initialize the appropriate model based on provider
    if (config.provider === 'anthropic') {
      this.model = anthropic(config.model);
    } else {
      this.model = openai(config.model);
    }
  }

  async executeTask(task: CodingTask): Promise<void> {
    console.log(chalk.blue('🤖 Coding Agent Starting...'));
    console.log(chalk.cyan(`📋 Task: ${task.description}`));
    
    if (task.context) {
      console.log(chalk.gray(`📝 Context: ${task.context}`));
    }
    
    if (task.constraints?.length) {
      console.log(chalk.yellow(`⚠️ Constraints: ${task.constraints.join(', ')}`));
    }

    console.log(chalk.green('\n🚀 Beginning task execution...\n'));

    const userPrompt = this.buildPrompt(task);

    try {
      // Use streamText for real-time output
      const { textStream } = streamText({
        model: this.model,
        system: SYSTEM_PROMPT,
        prompt: userPrompt,
        tools,
        maxTokens: this.config.maxTokens,
        temperature: this.config.temperature,
        maxToolRoundtrips: 10,
      });

      // Stream the response and handle tool calls
      for await (const textPart of textStream) {
        process.stdout.write(chalk.white(textPart));
      }

      console.log(chalk.green('\n\n✅ Task completed successfully!'));
    } catch (error: any) {
      console.error(chalk.red('\n❌ Error executing task:'), error.message);
      
      if (error.message.includes('API key')) {
        console.log(chalk.yellow('\n💡 Make sure to set your API key:'));
        console.log(chalk.gray('   export ANTHROPIC_API_KEY="your-key-here"'));
        console.log(chalk.gray('   # or'));
        console.log(chalk.gray('   export OPENAI_API_KEY="your-key-here"'));
      }
    }
  }

  async planTask(task: CodingTask): Promise<string> {
    console.log(chalk.blue('🤖 Planning task...'));

    const planningPrompt = `Given this coding task, create a step-by-step plan:

Task: ${task.description}
${task.context ? `Context: ${task.context}` : ''}
${task.constraints?.length ? `Constraints: ${task.constraints.join(', ')}` : ''}

Please provide a detailed plan with numbered steps for how to approach this task. Consider:
1. Understanding the current codebase structure
2. Identifying what needs to be implemented or changed
3. The order of operations
4. What tools you'll need to use
5. Testing and validation steps

Return just the plan without executing any tools yet.`;

    try {
      const { text } = await generateText({
        model: this.model,
        system: 'You are a coding assistant that creates detailed plans for development tasks.',
        prompt: planningPrompt,
        maxTokens: 1500,
        temperature: 0.1,
      });

      console.log(chalk.cyan('\n📋 Task Plan:'));
      console.log(chalk.white(text));
      
      return text;
    } catch (error: any) {
      console.error(chalk.red('❌ Error creating plan:'), error.message);
      return 'Failed to create task plan';
    }
  }

  private buildPrompt(task: CodingTask): string {
    let prompt = `I need help with the following coding task:

${task.description}`;

    if (task.context) {
      prompt += `

Additional context:
${task.context}`;
    }

    if (task.constraints?.length) {
      prompt += `

Constraints to consider:
${task.constraints.map(c => `- ${c}`).join('\n')}`;
    }

    prompt += `

Please help me accomplish this task step by step. Start by exploring the codebase to understand the current structure and implementation, then proceed with the necessary changes.

Working directory: ${this.config.workspace}`;

    return prompt;
  }

  getConfig(): AgentConfig {
    return this.config;
  }
}