import { exec } from "child_process";
import { promisify } from "util";

// Promisify exec for async/await usage
const execPromise = promisify(exec);

export interface ExecOptions {
  timeout?: number;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export async function execAsync(
  command: string,
  options?: ExecOptions
): Promise<{ stdout: string; stderr: string }> {
  try {
    const result = await execPromise(command, {
      timeout: options?.timeout || 30000, // Default 30 second timeout
      cwd: options?.cwd,
      env: { ...process.env, ...options?.env },
    });

    return {
      stdout: result.stdout,
      stderr: result.stderr,
    };
  } catch (error: any) {
    // Re-throw with more context
    throw new Error(`Command failed: ${command}\nError: ${error.message}`);
  }
}