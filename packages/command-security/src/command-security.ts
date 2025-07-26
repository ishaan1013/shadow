/**
 * Command security utilities for safe command execution
 * Three-tier security model: SAFE, APPROVAL_REQUIRED, and BLOCKED
 */

import path from "path";
import { CommandSecurityLevel, CommandValidationResult } from "./types";

// Commands that are safe to execute without approval
const SAFE_COMMANDS = new Set([
  // Basic file operations (read-only)
  "ls", "cat", "head", "tail", "grep", "find", "which", "file", "wc", "sort", "uniq",
  "tree", "du", "stat", "readlink", "basename", "dirname",
  
  // Text processing
  "awk", "sed", "cut", "tr", "tee", "jq", "yq",
  
  // Development tools
  "node", "npm", "yarn", "pnpm", "python", "python3", "pip", "pip3",
  "cargo", "rustc", "go", "java", "javac", "mvn", "gradle",
  "git", "gcc", "g++", "clang", "clang++", "make", "cmake",
  
  // Development utilities
  "tsc", "tsx", "ts-node", "jest", "vitest", "pytest", "rspec",
  "eslint", "prettier", "black", "rustfmt", "gofmt",
  
  // System info (read-only)
  "ps", "top", "htop", "df", "free", "uname", "whoami", "id", "pwd", "date",
  "hostname", "uptime", "lsb_release",
  
  // Network utilities (safe ones)
  "curl", "wget", "ping", "nslookup", "dig", "host", "traceroute",
  
  // Archive/compression
  "tar", "gzip", "gunzip", "zip", "unzip", "bzip2", "bunzip2",
  
  // Text editors (read-only mode assumed)
  "less", "more", "view",
]);

// Commands that require user approval (if approval is enabled)
const APPROVAL_REQUIRED_COMMANDS = new Set([
  // File operations (potentially destructive)
  "rm", "rmdir", "mv", "cp", "ln", "touch", "mkdir", "install",
  
  // Shell execution (controlled)
  "sh", "bash", "zsh", "fish", "dash",
  
  // Environment inspection
  "env", "printenv", "export", "set",
  
  // Process control (with restrictions)
  "kill", "killall", "pkill", "jobs", "fg", "bg",
  
  // Container operations
  "docker", "docker-compose", "podman", "kubectl",
  
  // Package management (system-wide)
  "apt", "apt-get", "yum", "dnf", "pacman", "brew", "snap",
  
  // Network operations
  "nc", "netcat", "socat", "telnet", "ftp", "sftp",
  
  // Service management
  "systemctl", "service", "pm2",
]);

// Commands that are never allowed
const BLOCKED_COMMANDS = new Set([
  // Privilege escalation
  "sudo", "su", "doas", "passwd", "chpasswd", "usermod", "useradd", "userdel",
  
  // System modification
  "mount", "umount", "fdisk", "parted", "dd", "mkfs", "fsck",
  "sysctl", "modprobe", "insmod", "rmmod",
  
  // Permission changes (too dangerous even with approval)
  "chmod", "chown", "chgrp", "setfacl", "getfacl",
  
  // Remote access (security risk)
  "ssh", "scp", "rsync", "rsh", "rlogin",
  
  // Dangerous utilities
  "nohup", "disown", "eval", "exec", "source",
  
  // System shutdown/reboot
  "shutdown", "reboot", "halt", "poweroff", "init",
]);

// Patterns that indicate potential injection attempts
const INJECTION_PATTERNS = [
  /[;&|`$(){}[\]]/,    // Shell metacharacters
  /\x00/,              // Null bytes
  /\$\{[^}]*\}/,       // Variable expansion
  /\$\([^)]*\)/,       // Command substitution
  /`[^`]*`/,           // Backtick command substitution
  /<<[-\s]*['"]?\w+/,  // Here documents
  /[<>]\s*&\d*/,       // Advanced redirection
];

// Safe redirection patterns (allowed)
const SAFE_REDIRECTION_PATTERNS = [
  /^>\s*[a-zA-Z0-9._\-/]+$/,    // Simple output redirection
  /^>>\s*[a-zA-Z0-9._\-/]+$/,   // Simple append redirection
  /^<\s*[a-zA-Z0-9._\-/]+$/,    // Simple input redirection
  /^2>&1$/,                       // Stderr to stdout
];

// Logger interface for dependency injection
export interface SecurityLogger {
  warn(message: string, details?: Record<string, any>): void;
  info(message: string, details?: Record<string, any>): void;
}

// Default console logger
const defaultLogger: SecurityLogger = {
  warn: (message: string, details?: Record<string, any>) => {
    console.warn(message, details);
  },
  info: (message: string, details?: Record<string, any>) => {
    console.log(message, details);
  }
};

/**
 * Validate and sanitize a command for safe execution
 */
export function validateCommand(
  command: string, 
  args: string[] = [],
  workingDirectory?: string,
  logger: SecurityLogger = defaultLogger
): CommandValidationResult {
  // Basic input validation
  if (!command || typeof command !== "string") {
    return { isValid: false, error: "Command is required and must be a string" };
  }

  if (command.trim().length === 0) {
    return { isValid: false, error: "Command cannot be empty" };
  }

  // Normalize command (remove path, get base command name)
  const baseCommand = command.split("/").pop()?.toLowerCase();
  if (!baseCommand) {
    return { isValid: false, error: "Invalid command format" };
  }

  // Determine security level
  let securityLevel: CommandSecurityLevel;

  if (BLOCKED_COMMANDS.has(baseCommand)) {
    logger.warn("[COMMAND_SECURITY] Blocked command attempted", { command: baseCommand });
    return { 
      isValid: false, 
      error: `Command '${baseCommand}' is permanently blocked for security reasons`,
      securityLevel: CommandSecurityLevel.BLOCKED
    };
  } else if (APPROVAL_REQUIRED_COMMANDS.has(baseCommand)) {
    securityLevel = CommandSecurityLevel.APPROVAL_REQUIRED;
  } else if (SAFE_COMMANDS.has(baseCommand)) {
    securityLevel = CommandSecurityLevel.SAFE;
  } else {
    // Unknown commands are treated as potentially dangerous but allowed
    logger.warn("[COMMAND_SECURITY] Unknown command, treating as potentially dangerous", { command: baseCommand });
    securityLevel = CommandSecurityLevel.APPROVAL_REQUIRED;
  }

  // Check for injection patterns in command
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(command)) {
      // Check if it's a safe redirection pattern
      const isSafeRedirection = SAFE_REDIRECTION_PATTERNS.some(safe => safe.test(command));
      if (!isSafeRedirection) {
        logger.warn("[COMMAND_SECURITY] Injection pattern detected in command", { 
          command, 
          pattern: pattern.toString() 
        });
        return { isValid: false, error: "Command contains potentially dangerous characters" };
      }
    }
  }

  // Validate and sanitize arguments
  const sanitizedArgs: string[] = [];
  const validationDetails: string[] = [];

  for (const arg of args) {
    if (typeof arg !== "string") {
      return { isValid: false, error: "All arguments must be strings" };
    }

    // Special handling for redirection operators as arguments
    if ([">", ">>", "<", "2>&1"].includes(arg.trim())) {
      sanitizedArgs.push(arg);
      continue;
    }

    // Check for injection patterns in arguments
    let hasDangerousPattern = false;
    for (const pattern of INJECTION_PATTERNS) {
      if (pattern.test(arg)) {
        // Allow certain patterns in specific contexts
        if (baseCommand === "grep" && /[(){}[\]|]/.test(arg)) {
          // Grep regex patterns are allowed
          continue;
        }
        if ((baseCommand === "sed" || baseCommand === "awk") && /[{}$]/.test(arg)) {
          // Sed/awk patterns are allowed
          continue;
        }
        if ((baseCommand === "find" || baseCommand === "ls") && /[*?[\]]/.test(arg)) {
          // Glob patterns are allowed for find/ls
          continue;
        }
        
        hasDangerousPattern = true;
        logger.warn("[COMMAND_SECURITY] Injection pattern detected in argument", { 
          arg, 
          pattern: pattern.toString() 
        });
        break;
      }
    }

    if (hasDangerousPattern) {
      return { isValid: false, error: "Argument contains potentially dangerous characters" };
    }

    // Check for null bytes
    if (arg.includes("\0")) {
      return { isValid: false, error: "Arguments cannot contain null bytes" };
    }

    // Length limit for arguments
    if (arg.length > 1000) {
      return { isValid: false, error: "Argument too long (max 1000 characters)" };
    }

    sanitizedArgs.push(arg);
  }

  // Additional validation for specific commands
  const specificValidation = validateSpecificCommand(
    baseCommand, 
    sanitizedArgs, 
    workingDirectory,
    validationDetails
  );
  
  if (!specificValidation.isValid) {
    return specificValidation;
  }

  // Log when executing potentially dangerous commands for audit trail
  if (securityLevel === CommandSecurityLevel.APPROVAL_REQUIRED) {
    logger.info("[COMMAND_SECURITY] Executing approval-required command", {
      command: baseCommand,
      args: sanitizedArgs,
      validationDetails: validationDetails.length > 0 ? validationDetails : undefined,
    });
  }

  return { 
    isValid: true, 
    sanitizedCommand: baseCommand,
    sanitizedArgs,
    securityLevel,
  };
}

/**
 * Command-specific validation rules
 */
function validateSpecificCommand(
  command: string, 
  args: string[], 
  workingDirectory?: string,
  validationDetails?: string[]
): CommandValidationResult {
  const workspaceRoot = workingDirectory || process.cwd();

  switch (command) {
    case "rm":
    case "rmdir":
      // Enhanced validation for remove operations
      if (args.some(arg => arg === "-rf" || arg === "-fr")) {
        if (args.some(arg => arg === "/" || arg === "/*")) {
          return { isValid: false, error: "Cannot use rm -rf on root directory" };
        }
        validationDetails?.push("Using -rf flag, be careful");
      }
      
      // Check paths are within workspace
      for (const arg of args) {
        if (arg.startsWith("-")) continue; // Skip flags
        
        if (!isPathWithinWorkspace(arg, workspaceRoot)) {
          return { isValid: false, error: `Path '${arg}' is outside workspace` };
        }
        
        // Warn about common important files
        const importantFiles = [".git", "node_modules", ".env", "package.json", "Cargo.toml"];
        if (importantFiles.some(f => arg.includes(f))) {
          validationDetails?.push(`Warning: Removing ${arg} which appears to be an important file`);
        }
      }
      break;
      
    case "mv":
    case "cp":
      // Ensure source and destination are within workspace
      const paths = args.filter(arg => !arg.startsWith("-"));
      for (const p of paths) {
        if (!isPathWithinWorkspace(p, workspaceRoot)) {
          return { isValid: false, error: `Path '${p}' is outside workspace` };
        }
      }
      
      // Check for overwriting important files
      if (paths.length >= 2) {
        const dest = paths[paths.length - 1];
        const importantFiles = [".git", ".env", "package.json", "Cargo.toml"];
        if (dest && importantFiles.some(f => dest.includes(f))) {
          validationDetails?.push(`Warning: Overwriting ${dest} which appears to be an important file`);
        }
      }
      break;
      
    case "sh":
    case "bash":
    case "zsh":
    case "fish":
      // Only allow script execution, not interactive shells
      if (args.length === 0 || args.some(arg => arg === "-i" || arg === "--interactive")) {
        return { isValid: false, error: "Interactive shell sessions are not allowed" };
      }
      
      // Ensure script path is within workspace
      const scriptPath = args.find(arg => !arg.startsWith("-"));
      if (scriptPath && !isPathWithinWorkspace(scriptPath, workspaceRoot)) {
        return { isValid: false, error: "Script must be within workspace" };
      }
      
      validationDetails?.push("Executing shell script");
      break;
      
    case "kill":
    case "killall":
    case "pkill":
      // Only allow killing processes by PID, not by name (too broad)
      if (command === "kill") {
        const pids = args.filter(arg => !arg.startsWith("-"));
        for (const pid of pids) {
          if (!/^\d+$/.test(pid)) {
            return { isValid: false, error: "Kill command only accepts numeric PIDs" };
          }
        }
      } else {
        validationDetails?.push("Warning: killall/pkill can affect multiple processes");
      }
      break;
      
    case "curl":
    case "wget":
      // Enhanced URL validation
      const urlArgs = args.filter(arg => arg.startsWith("http"));
      for (const url of urlArgs) {
        if (!isValidUrl(url)) {
          return { isValid: false, error: "Invalid URL format" };
        }
        
        // Warn about potentially dangerous URLs
        if (url.includes("localhost") || url.includes("127.0.0.1") || url.includes("0.0.0.0")) {
          validationDetails?.push("Warning: Accessing localhost URLs");
        }
      }
      
      // Check output paths
      const outputIndex = args.findIndex(arg => arg === "-o" || arg === "--output");
      if (outputIndex !== -1 && outputIndex + 1 < args.length) {
        const outputPath = args[outputIndex + 1];
        if (outputPath && !isPathWithinWorkspace(outputPath, workspaceRoot)) {
          return { isValid: false, error: "Output file must be within workspace" };
        }
      }
      break;
      
    case "docker":
      // Enhanced docker validation
      if (args.includes("--privileged")) {
        return { isValid: false, error: "Privileged docker containers are not allowed" };
      }
      if (args.some(arg => arg.includes("--user=root") || arg.includes("-u=root"))) {
        return { isValid: false, error: "Running docker as root is not allowed" };
      }
      if (args.includes("run") && !args.includes("--rm")) {
        validationDetails?.push("Consider using --rm flag to auto-remove container");
      }
      break;
      
    case "npm":
    case "yarn":
    case "pnpm":
      // Allow global installs with warning
      if (args.includes("-g") || args.includes("--global")) {
        validationDetails?.push("Warning: Global package installation requested");
      }
      
      // Warn about install scripts
      if (args.includes("install") || args.includes("i")) {
        validationDetails?.push("Note: Package installation may run scripts");
      }
      break;
      
    case "git":
      // Allow most git operations but validate remote operations
      if (args.includes("push") && args.includes("--force")) {
        validationDetails?.push("Warning: Force push requested");
      }
      if (args.includes("reset") && args.includes("--hard")) {
        validationDetails?.push("Warning: Hard reset will lose uncommitted changes");
      }
      break;
  }

  return { isValid: true };
}

/**
 * Check if a path is within the workspace boundaries
 */
function isPathWithinWorkspace(targetPath: string, workspaceRoot: string): boolean {
  // Handle special cases
  if (targetPath === "." || targetPath === "./") return true;
  if (targetPath.includes("..")) {
    // Resolve the path and check if it's still within workspace
    const resolved = path.resolve(workspaceRoot, targetPath);
    return resolved.startsWith(workspaceRoot);
  }
  
  // Absolute paths must be within workspace
  if (path.isAbsolute(targetPath)) {
    return targetPath.startsWith(workspaceRoot);
  }
  
  // Relative paths are generally OK if they don't escape
  return !targetPath.startsWith("/");
}

/**
 * Basic URL validation
 */
function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return ["http:", "https:", "ftp:", "ftps:"].includes(parsed.protocol);
  } catch {
    return false;
  }
}

/**
 * Parse a command string into command and arguments safely
 */
export function parseCommand(commandString: string): { command: string; args: string[] } {
  // Handle quoted arguments properly
  const parts: string[] = [];
  let current = "";
  let inQuote = false;
  let quoteChar = "";
  let escaped = false;

  for (let i = 0; i < commandString.length; i++) {
    const char = commandString[i];
    
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    
    if (char === "\\") {
      escaped = true;
      continue;
    }
    
    if (inQuote) {
      if (char === quoteChar) {
        inQuote = false;
        quoteChar = "";
      } else {
        current += char;
      }
    } else {
      if (char === '"' || char === "'") {
        inQuote = true;
        quoteChar = char;
      } else if (char === " " || char === "\t") {
        if (current) {
          parts.push(current);
          current = "";
        }
      } else {
        current += char;
      }
    }
  }
  
  if (current) {
    parts.push(current);
  }
  
  const command = parts[0] || "";
  const args = parts.slice(1);
  
  return { command, args };
}

/**
 * Log security event for command validation
 */
export function logCommandSecurityEvent(
  event: string, 
  details: Record<string, any>,
  logger: SecurityLogger = defaultLogger
): void {
  logger.warn(`[COMMAND_SECURITY] ${event}`, {
    ...details,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Get command security level
 */
export function getCommandSecurityLevel(command: string): CommandSecurityLevel {
  const baseCommand = command.split("/").pop()?.toLowerCase();
  if (!baseCommand) return CommandSecurityLevel.BLOCKED;
  
  if (BLOCKED_COMMANDS.has(baseCommand)) {
    return CommandSecurityLevel.BLOCKED;
  } else if (SAFE_COMMANDS.has(baseCommand)) {
    return CommandSecurityLevel.SAFE;
  } else {
    return CommandSecurityLevel.APPROVAL_REQUIRED;
  }
}