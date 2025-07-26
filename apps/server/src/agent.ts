#!/usr/bin/env node

import { prisma } from "@repo/db";
import { ModelType } from "@repo/types";
import { randomUUID } from "crypto";
import readline from "readline";
import { ChatService, DEFAULT_MODEL } from "./chat";
import config from "./config";

interface LocalAgentOptions {
  model?: ModelType;
  taskId?: string;
  workspaceDir?: string;
}

class LocalCodingAgent {
  private chatService: ChatService;
  private taskId: string;
  private rl: readline.Interface;
  private model: ModelType;

  constructor(options: LocalAgentOptions = {}) {
    this.chatService = new ChatService();
    this.taskId = options.taskId || randomUUID();
    this.model = options.model || DEFAULT_MODEL;

    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: "\n> ",
    });

    console.log("🤖 Shadow Coding Agent - Local Mode");
    console.log("=====================================");
    console.log(`Task ID: ${this.taskId}`);
    console.log(`Model: ${this.model}`);
    console.log(`Workspace: ${config.workspaceDir}`);
    console.log(`Debug Mode: ${config.debug ? "ON" : "OFF"}`);
    console.log("=====================================\n");
  }

  async start() {
    // Create the task record in database first
    await this.ensureTaskExists();

    console.log("Welcome to the Shadow Coding Agent! 🚀");
    console.log("I can help you with coding tasks using a variety of tools.");
    console.log("Type your request and I'll get to work!\n");
    console.log("Commands:");
    console.log("  /help     - Show this help");
    console.log("  /model    - Change the AI model");
    console.log("  /history  - Show conversation history");
    console.log("  /clear    - Clear conversation history");
    console.log("  /exit     - Exit the agent\n");

    this.rl.prompt();

    this.rl.on("line", async (input) => {
      const line = input.trim();

      if (line === "/exit") {
        console.log("\nGoodbye! 👋");
        process.exit(0);
      }

      if (line === "/help") {
        this.showHelp();
        this.rl.prompt();
        return;
      }

      if (line === "/model") {
        await this.selectModel();
        this.rl.prompt();
        return;
      }

      if (line === "/history") {
        await this.showHistory();
        this.rl.prompt();
        return;
      }

      if (line === "/clear") {
        this.taskId = randomUUID();
        // Create new task record for the new task ID
        await this.ensureTaskExists();
        console.log(
          "🧹 Conversation history cleared. New task ID:",
          this.taskId
        );
        this.rl.prompt();
        return;
      }

      if (line.length === 0) {
        this.rl.prompt();
        return;
      }

      // Process the user's coding request
      await this.processCodingRequest(line);
      this.rl.prompt();
    });

    this.rl.on("close", () => {
      console.log("\nGoodbye! 👋");
      process.exit(0);
    });
  }

  private async ensureTaskExists() {
    try {
      // Check if task already exists
      const existingTask = await prisma.task.findUnique({
        where: { id: this.taskId },
      });

      if (existingTask) {
        return;
      }

      // Ensure we have a default user for local agent
      const defaultUser = await this.ensureDefaultUser();

      // Create the task record
      await prisma.task.create({
        data: {
          id: this.taskId,
          title: "Local Agent Session",
          description: "Local coding agent session",
          repoUrl: config.workspaceDir, // Use workspace dir as "repo"
          baseBranch: "local", // Track the original branch for git-first workflow
          shadowBranch: `shadow/task-${this.taskId}`,
          baseCommitSha: "local", // Track the original branch for git-first workflow
          userId: defaultUser.id,
          mode: "FULL_AUTO",
          status: "RUNNING",
          initializationStatus: "COMPLETED", // Local mode doesn't need initialization
          workspacePath: config.workspaceDir,
        },
      });

      console.log(`✅ Task record created: ${this.taskId}`);
    } catch (error) {
      console.error("❌ Error creating task record:", error);
      throw error;
    }
  }

  private async ensureDefaultUser() {
    const defaultEmail = "local-agent@shadow.dev";

    try {
      // Try to find existing default user
      let user = await prisma.user.findUnique({
        where: { email: defaultEmail },
      });

      if (!user) {
        user = await prisma.user.create({
          data: {
            id: randomUUID(),
            emailVerified: true,
            createdAt: new Date(),
            updatedAt: new Date(),
            email: defaultEmail,
            name: "Local Agent User",
          },
        });
        console.log(`✅ Default user created: ${user.email}`);
      }

      return user;
    } catch (error) {
      console.error("❌ Error creating default user:", error);
      throw error;
    }
  }

  private showHelp() {
    console.log("\n📚 Shadow Coding Agent Help");
    console.log("==========================");
    console.log(
      "I'm a coding assistant that can help you with various programming tasks."
    );
    console.log("I have access to the following tools:");
    console.log("  • Read and edit files");
    console.log("  • Run terminal commands");
    console.log("  • Search through codebases");
    console.log("  • List directories");
    console.log("  • Search for files");
    console.log("  • Delete files");
    console.log("\nJust describe what you want to do in natural language!");
    console.log("Examples:");
    console.log('  "Create a new React component for a login form"');
    console.log('  "Fix the bug in the authentication module"');
    console.log('  "Add unit tests for the API endpoints"');
    console.log('  "Refactor the database connection code"');
  }

  private async selectModel() {
    const availableModels = this.chatService.getAvailableModels();

    console.log("\n🧠 Available Models:");
    availableModels.forEach((model, index) => {
      const current = model === this.model ? " (current)" : "";
      console.log(`  ${index + 1}. ${model}${current}`);
    });

    const answer = await this.askQuestion("Select a model (number): ");
    const modelIndex = parseInt(answer) - 1;

    if (modelIndex >= 0 && modelIndex < availableModels.length) {
      const selectedModel = availableModels[modelIndex];
      if (selectedModel) {
        this.model = selectedModel;
        console.log(`✅ Model changed to: ${this.model}`);
      } else {
        console.log("❌ Invalid selection");
      }
    } else {
      console.log("❌ Invalid selection");
    }
  }

  private async showHistory() {
    try {
      const history = await this.chatService.getChatHistory(this.taskId);

      if (history.length === 0) {
        console.log("\n📝 No conversation history yet.");
        return;
      }

      console.log("\n📝 Conversation History:");
      console.log("========================");

      history.forEach((message, index) => {
        const timestamp = new Date(message.createdAt).toLocaleTimeString();
        const role = message.role.toUpperCase();
        const content =
          message.content.length > 100
            ? message.content.substring(0, 100) + "..."
            : message.content;

        console.log(`${index + 1}. [${timestamp}] ${role}: ${content}`);

        if (message.metadata?.tool) {
          console.log(`   🔧 Tool: ${message.metadata.tool.name}`);
        }
      });
    } catch (error) {
      console.error("❌ Error fetching history:", error);
    }
  }

  private async processCodingRequest(request: string) {
    try {
      console.log("\n🤖 Processing your request...");
      console.log("================================");

      // Set up real-time streaming output
      this.setupStreamingOutput();

      await this.chatService.processCodingTask(
        this.taskId,
        request,
        this.model
      );

      console.log("\n✅ Task completed!");
    } catch (error) {
      console.error("\n❌ Error processing request:", error);
    }
  }

  private setupStreamingOutput() {
    // In a real implementation, you'd integrate with the socket system
    // For now, we'll just log that streaming is set up
    console.log("📡 Streaming output initialized...");
  }


  private askQuestion(question: string): Promise<string> {
    return new Promise((resolve) => {
      this.rl.question(question, (answer) => {
        resolve(answer.trim());
      });
    });
  }

}

// CLI entry point
async function main() {
  const args = process.argv.slice(2);
  const options: LocalAgentOptions = {};

  // Parse command line arguments
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--model" && i + 1 < args.length) {
      options.model = args[i + 1] as ModelType;
      i++;
    } else if (arg === "--task-id" && i + 1 < args.length) {
      options.taskId = args[i + 1];
      i++;
    } else if (arg === "--help") {
      console.log("Shadow Coding Agent - Local Mode");
      console.log("Usage: npm run agent [options]");
      console.log("");
      console.log("Options:");
      console.log("  --model <model>     Set the AI model to use");
      console.log("  --task-id <id>      Set a specific task ID");
      console.log("  --help              Show this help message");
      console.log("");
      console.log(
        "Available models: claude-3-5-sonnet-20241022, claude-3-5-haiku-20241022, gpt-4o, gpt-4o-mini"
      );
      process.exit(0);
    }
  }

  const agent = new LocalCodingAgent(options);
  await agent.start();
}

// Run if called directly

if (require.main === module) {
  main().catch(console.error);
}

export { LocalCodingAgent };
