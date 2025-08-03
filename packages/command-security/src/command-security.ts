/**
 * Simplified command security for containerized environments
 * Philosophy: Trust container isolation, block only genuinely dangerous commands
 */

import path from "path";
import { CommandSecurityLevel, CommandValidationResult } from "./types";

// Commands that are absolutely never allowed (true security risks)
const BLOCKED_COMMANDS = new Set([
  // Privilege escalation
  "sudo",
  "su", 
  "doas",
  "passwd",
  "chpasswd",
  "usermod",
  "useradd",
  "userdel",

  // System modification (dangerous even in containers)
  "mount",
  "umount", 
  "fdisk",
  "parted",
  "dd",
  "mkfs",
  "fsck",
  "sysctl",
  "modprobe",
  "insmod",
  "rmmod",

  // Remote access vectors
  "ssh",
  "scp", 
  "rsync",
  "rsh",
  "rlogin",

  // Code execution risks
  "eval",
  "exec",
  "source",

  // System control
  "shutdown",
  "reboot",
  "halt", 
  "poweroff",
  "init",
]);

// Dangerous patterns to block
const BLOCKED_PATTERNS = [
  /rm\s+.*-rf\s+\/\s*$/,              // rm -rf /
  /rm\s+.*-rf\s+\/\w+\s*$/,           // rm -rf /usr, /etc, etc
  />\s*\/dev\/(null|zero|random)/,     // device file manipulation
  /\/proc\/[0-9]+\/mem/,              // process memory access  
  /\/sys\//,                          // sysfs manipulation
];

// Logger interface for dependency injection
export interface SecurityLogger {
  warn(message: string, details?: Record<string, unknown>): void;
  info(message: string, details?: Record<string, unknown>): void;
}

// Default console logger
const defaultLogger: SecurityLogger = {
  warn: (message: string, details?: Record<string, unknown>) => {
    console.warn(`[SECURITY] ${message}`, details);
  },
  info: (message: string, details?: Record<string, unknown>) => {
    console.log(`[SECURITY] ${message}`, details);
  },
};

/**
 * Validate and sanitize a command for safe execution
 * Simple approach: Block dangerous commands, allow everything else
 */
export function validateCommand(
  command: string,
  args: string[] = [],
  workingDirectory?: string,
  logger: SecurityLogger = defaultLogger
): CommandValidationResult {
  // Basic input validation
  if (!command || typeof command !== "string" || command.trim().length === 0) {
    return {
      isValid: false,
      error: "Command is required and must be a non-empty string",
    };
  }

  // Get base command name
  const baseCommand = command.split(/\s+/)[0]?.split("/").pop()?.toLowerCase();
  if (!baseCommand) {
    return { isValid: false, error: "Invalid command format" };
  }

  // Check if command is explicitly blocked
  if (BLOCKED_COMMANDS.has(baseCommand)) {
    logger.warn("Blocked dangerous command", { command: baseCommand });
    return {
      isValid: false,
      error: `Command '${baseCommand}' is blocked for security reasons`,
      securityLevel: CommandSecurityLevel.BLOCKED,
    };
  }

  // Check for dangerous patterns in full command string
  const fullCommand = `${command} ${args.join(" ")}`.trim();
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(fullCommand)) {
      logger.warn("Blocked dangerous command pattern", { 
        command: fullCommand,
        pattern: pattern.toString() 
      });
      return {
        isValid: false,
        error: "Command contains dangerous pattern",
        securityLevel: CommandSecurityLevel.BLOCKED,
      };
    }
  }

  // Check for null bytes (classic injection vector)
  if (fullCommand.includes("\0")) {
    return { 
      isValid: false, 
      error: "Command cannot contain null bytes",
      securityLevel: CommandSecurityLevel.BLOCKED,
    };
  }

  // Path traversal protection - keep operations within workspace
  const workspaceRoot = workingDirectory || process.cwd();
  for (const arg of args) {
    if (arg.includes("..") && !isPathWithinWorkspace(arg, workspaceRoot)) {
      logger.warn("Path traversal attempt blocked", { arg, workspaceRoot });
      return {
        isValid: false,
        error: `Path '${arg}' is outside workspace boundaries`,
        securityLevel: CommandSecurityLevel.BLOCKED,
      };
    }
  }

  // Everything else is allowed - trust container isolation
  logger.info("Command validated successfully", { 
    command: baseCommand,
    args: args.length > 0 ? args.length : undefined 
  });

  return {
    isValid: true,
    sanitizedCommand: baseCommand,
    sanitizedArgs: args,
    securityLevel: CommandSecurityLevel.SAFE,
  };
}

/**
 * Check if a path is within the workspace boundaries
 */
function isPathWithinWorkspace(targetPath: string, workspaceRoot: string): boolean {
  // Handle special cases
  if (targetPath === "." || targetPath === "./") return true;
  
  // Resolve the path and check if it's still within workspace
  if (targetPath.includes("..")) {
    try {
      const resolved = path.resolve(workspaceRoot, targetPath);
      return resolved.startsWith(workspaceRoot);
    } catch {
      return false;
    }
  }

  // Absolute paths must be within workspace
  if (path.isAbsolute(targetPath)) {
    return targetPath.startsWith(workspaceRoot);
  }

  // Relative paths are generally OK if they don't escape
  return !targetPath.startsWith("/");
}

/**
 * Parse a command string into command and arguments safely
 */
export function parseCommand(commandString: string): {
  command: string;
  args: string[];
} {
  // Simple split approach - let shell handle complex parsing
  const parts = commandString.trim().split(/\s+/);
  const command = parts[0] || "";
  const args = parts.slice(1);

  return { command, args };
}

/**
 * Log security event for command validation  
 */
export function logCommandSecurityEvent(
  event: string,
  details: Record<string, unknown>,
  logger: SecurityLogger = defaultLogger
): void {
  logger.warn(event, {
    ...details,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Get command security level (simplified)
 */
export function getCommandSecurityLevel(command: string): CommandSecurityLevel {
  const baseCommand = command.split("/").pop()?.toLowerCase();
  if (!baseCommand) return CommandSecurityLevel.BLOCKED;

  return BLOCKED_COMMANDS.has(baseCommand) 
    ? CommandSecurityLevel.BLOCKED 
    : CommandSecurityLevel.SAFE;
}