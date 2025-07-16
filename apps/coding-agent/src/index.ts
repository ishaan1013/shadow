#!/usr/bin/env node

import chalk from 'chalk';
import { CodingAgent, CodingTask } from './agent';
import { getConfig } from './config';

async function main() {
  const config = getConfig();
  const agent = new CodingAgent(config);

  console.log(chalk.blue('🤖 Shadow Coding Agent'));
  console.log(chalk.gray(`Provider: ${config.provider} | Model: ${config.model}`));
  console.log(chalk.gray(`Workspace: ${config.workspace}`));
  console.log();

  // Get task from command line arguments
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log(chalk.yellow('Usage: npm run dev "Your task description"'));
    console.log(chalk.gray('Example: npm run dev "Create a simple Express.js API with a /health endpoint"'));
    console.log();
    console.log(chalk.cyan('Available commands:'));
    console.log(chalk.white('  npm run dev "task description"  - Execute a coding task'));
    console.log(chalk.white('  npm run plan "task description" - Create a plan for a task'));
    process.exit(1);
  }

  const command = args[0];
  let taskDescription = '';
  let isPlanning = false;

  // Check if the first argument is a command
  if (command === 'plan') {
    isPlanning = true;
    taskDescription = args.slice(1).join(' ');
  } else {
    taskDescription = args.join(' ');
  }

  if (!taskDescription.trim()) {
    console.error(chalk.red('❌ Please provide a task description'));
    process.exit(1);
  }

  const task: CodingTask = {
    description: taskDescription,
    context: `Working in a monorepo with Next.js frontend, Node.js server, and shared packages. 
The workspace contains apps for frontend, server, and coding-agent, plus shared packages for db, types, and config.`,
    constraints: [
      'Follow existing code patterns and structure',
      'Use TypeScript for all code',
      'Ensure compatibility with the monorepo setup',
      'Test changes when possible'
    ]
  };

  try {
    if (isPlanning) {
      await agent.planTask(task);
    } else {
      await agent.executeTask(task);
    }
  } catch (error: any) {
    console.error(chalk.red('❌ Unexpected error:'), error.message);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log(chalk.yellow('\n\n⏹️ Agent stopped by user'));
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log(chalk.yellow('\n\n⏹️ Agent terminated'));
  process.exit(0);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason: any) => {
  console.error(chalk.red('❌ Unhandled promise rejection:'), reason);
  process.exit(1);
});

if (require.main === module) {
  main().catch((error) => {
    console.error(chalk.red('❌ Fatal error:'), error);
    process.exit(1);
  });
}

export { CodingAgent } from './agent';
export type { CodingTask } from './agent';
export { getConfig } from './config';
export { tools } from './tools';