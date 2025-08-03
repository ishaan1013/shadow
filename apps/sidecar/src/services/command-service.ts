import { spawn, ChildProcess } from "child_process";
import { EventEmitter } from "events";
import { config } from "../config";
import { logger } from "../utils/logger";
import { WorkspaceService } from "./workspace-service";
import { CommandResponse } from "@repo/types";
import {
  parseCommand,
} from "@repo/command-security";

export interface CommandStreamEvent {
  type: "stdout" | "stderr" | "exit" | "error";
  content?: string;
  code?: number;
  message?: string;
}

export class CommandService extends EventEmitter {
  private runningProcesses: Map<string, ChildProcess> = new Map();

  constructor(private workspaceService: WorkspaceService) {
    super();
  }

  /**
   * Execute a command and return the result
   */
  async executeCommand(
    command: string,
    isBackground: boolean = false,
    timeout?: number
  ): Promise<CommandResponse> {
    const workspaceDir = this.workspaceService.getWorkspaceDir();
    const commandTimeout = timeout || config.commandTimeoutMs;

    logger.info("Executing command", {
      command: command.substring(0, 100),
      isBackground,
      timeout: commandTimeout,
    });

    // Trust server-side validation - no double validation needed
    // Parse command for execution (no security validation here)
    const { command: baseCommand, args } = parseCommand(command);
    
    logger.info("Executing command in VM", {
      command: baseCommand,
      args: args.length > 0 ? args : undefined,
    });

    try {
      if (isBackground) {
        // For background commands, spawn without shell
        const child = spawn(baseCommand, args, {
          cwd: workspaceDir,
          detached: true,
          stdio: "ignore",
          shell: false,
        });

        // Store process reference
        const processId = `bg_${Date.now()}`;
        this.runningProcesses.set(processId, child);

        // Unref to allow parent to exit
        child.unref();

        logger.info("Background command started", { command: baseCommand, args, processId });

        return {
          success: true,
          message: `Background command started: ${baseCommand}`,
          isBackground: true,
        };
      } else {
        // For foreground commands, use secure spawn with timeout
        const result = await this.executeSecureCommand(baseCommand, args, workspaceDir, commandTimeout);

        return {
          success: true,
          stdout: result.stdout.trim(),
          stderr: result.stderr.trim(),
          message: `Command executed successfully: ${baseCommand}`,
        };
      }
    } catch (error) {
      logger.error("Command execution failed", { command: baseCommand, args, error });

      const errorMessage = error instanceof Error ? error.message : "Unknown error";

      // Check for timeout
      if (errorMessage.includes("TIMEOUT") || errorMessage.includes("ETIMEDOUT")) {
        return {
          success: false,
          message: `Command timed out after ${commandTimeout}ms: ${baseCommand}`,
          error: "TIMEOUT",
        };
      }

      // Extract stdout/stderr from error if available
      const execError = error as Error & { stdout?: string; stderr?: string };

      return {
        success: false,
        stdout: execError.stdout?.trim(),
        stderr: execError.stderr?.trim(),
        message: `Failed to execute command: ${baseCommand}`,
        error: errorMessage,
      };
    }
  }

  /**
   * Execute a command with streaming output
   */
  streamCommand(
    command: string,
    onData: (event: CommandStreamEvent) => void
  ): void {
    const workspaceDir = this.workspaceService.getWorkspaceDir();

    logger.info("Starting streaming command", { command: command.substring(0, 100) });

    // Trust server-side validation - no double validation needed
    const { command: baseCommand, args } = parseCommand(command);
    
    logger.info("Streaming command in VM", {
      command: baseCommand,
      args: args.length > 0 ? args : undefined,
    });

    const child = spawn(baseCommand, args, {
      cwd: workspaceDir,
      shell: false, // IMPORTANT: No shell to prevent injection
    });

    // Store process reference
    const processId = `stream_${Date.now()}`;
    this.runningProcesses.set(processId, child);

    // Handle stdout
    child.stdout.on("data", (data) => {
      onData({
        type: "stdout",
        content: data.toString(),
      });
    });

    // Handle stderr
    child.stderr.on("data", (data) => {
      onData({
        type: "stderr",
        content: data.toString(),
      });
    });

    // Handle exit
    child.on("exit", (code) => {
      onData({
        type: "exit",
        code: code || 0,
      });
      this.runningProcesses.delete(processId);
    });

    // Handle errors
    child.on("error", (error) => {
      logger.error("Streaming command error", { command: baseCommand, args, error });
      onData({
        type: "error",
        message: error.message,
      });
      this.runningProcesses.delete(processId);
    });
  }

  /**
   * Execute command securely using spawn with timeout
   */
  private async executeSecureCommand(
    command: string,
    args: string[],
    cwd: string,
    timeout: number
  ): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        cwd,
        stdio: ["pipe", "pipe", "pipe"],
        shell: false,
      });

      let stdout = "";
      let stderr = "";
      let timeoutId: NodeJS.Timeout | null = null;

      // Set up timeout
      if (timeout > 0) {
        timeoutId = setTimeout(() => {
          child.kill("SIGKILL");
          reject(new Error(`Command timed out after ${timeout}ms`));
        }, timeout);
      }

      child.stdout?.on("data", (data) => {
        stdout += data.toString();
      });

      child.stderr?.on("data", (data) => {
        stderr += data.toString();
      });

      // Handle process exit
      child.on("close", (code) => {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }

        if (code === 0) {
          resolve({ stdout, stderr });
        } else {
          const error = new Error(`Command failed with exit code ${code}: ${stderr || stdout}`) as Error & { stdout: string; stderr: string };
          error.stdout = stdout;
          error.stderr = stderr;
          reject(error);
        }
      });

      // Handle process errors
      child.on("error", (error) => {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        reject(error);
      });
    });
  }

  /**
   * Kill all running processes (for cleanup)
   */
  killAllProcesses(): void {
    logger.info("Killing all running processes", {
      count: this.runningProcesses.size
    });

    for (const [id, process] of this.runningProcesses) {
      try {
        process.kill("SIGKILL");
        logger.debug("Killed process", { id });
      } catch (error) {
        logger.error("Failed to kill process", { id, error });
      }
    }

    this.runningProcesses.clear();
  }
}

export default CommandService;