/**
 * Security utilities for input validation and sanitization
 */

import { logger } from "./logger";

// Security validation regexes
const SAFE_USERNAME_REGEX = /^[a-zA-Z0-9._-]+$/;
const SAFE_EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
const SAFE_BRANCH_REGEX = /^[a-zA-Z0-9._/-]+$/;
const SAFE_URL_REGEX = /^https:\/\/[a-zA-Z0-9.-]+\/[a-zA-Z0-9._/-]+\.git$/;

// Input length limits
const MAX_USERNAME_LENGTH = 100;
const MAX_EMAIL_LENGTH = 254;
const MAX_BRANCH_LENGTH = 250;
const MAX_COMMIT_MESSAGE_LENGTH = 2000;
const MAX_URL_LENGTH = 500;

export interface GitUser {
  name: string;
  email: string;
}

export interface ValidationResult {
  isValid: boolean;
  error?: string;
}

/**
 * Validate git username
 */
export function validateGitUsername(username: string): ValidationResult {
  if (!username || typeof username !== "string") {
    return { isValid: false, error: "Username is required and must be a string" };
  }

  if (username.length > MAX_USERNAME_LENGTH) {
    return { isValid: false, error: `Username too long (max ${MAX_USERNAME_LENGTH} characters)` };
  }

  if (!SAFE_USERNAME_REGEX.test(username)) {
    return { isValid: false, error: "Username contains invalid characters" };
  }

  return { isValid: true };
}

/**
 * Validate git email
 */
export function validateGitEmail(email: string): ValidationResult {
  if (!email || typeof email !== "string") {
    return { isValid: false, error: "Email is required and must be a string" };
  }

  if (email.length > MAX_EMAIL_LENGTH) {
    return { isValid: false, error: `Email too long (max ${MAX_EMAIL_LENGTH} characters)` };
  }

  if (!SAFE_EMAIL_REGEX.test(email)) {
    return { isValid: false, error: "Invalid email format" };
  }

  return { isValid: true };
}

/**
 * Validate git branch name
 */
export function validateBranchName(branch: string): ValidationResult {
  if (!branch || typeof branch !== "string") {
    return { isValid: false, error: "Branch name is required and must be a string" };
  }

  if (branch.length > MAX_BRANCH_LENGTH) {
    return { isValid: false, error: `Branch name too long (max ${MAX_BRANCH_LENGTH} characters)` };
  }

  if (!SAFE_BRANCH_REGEX.test(branch)) {
    return { isValid: false, error: "Branch name contains invalid characters" };
  }

  // Additional git branch name restrictions
  if (branch.startsWith("-") || branch.endsWith(".") || branch.includes("..")) {
    return { isValid: false, error: "Invalid branch name format" };
  }

  return { isValid: true };
}

/**
 * Validate commit message
 */
export function validateCommitMessage(message: string): ValidationResult {
  if (!message || typeof message !== "string") {
    return { isValid: false, error: "Commit message is required and must be a string" };
  }

  if (message.trim().length === 0) {
    return { isValid: false, error: "Commit message cannot be empty" };
  }

  if (message.length > MAX_COMMIT_MESSAGE_LENGTH) {
    return { isValid: false, error: `Commit message too long (max ${MAX_COMMIT_MESSAGE_LENGTH} characters)` };
  }

  // Check for potential injection attempts
  const dangerousPatterns = [
    /[;&|`$(){}[\]]/,  // Shell metacharacters
    /\x00/,            // Null bytes
    /\n.*\n/,          // Multi-line with potential command injection
  ];

  for (const pattern of dangerousPatterns) {
    if (pattern.test(message)) {
      return { isValid: false, error: "Commit message contains potentially dangerous characters" };
    }
  }

  return { isValid: true };
}

/**
 * Validate repository URL
 */
export function validateRepoUrl(url: string): ValidationResult {
  if (!url || typeof url !== "string") {
    return { isValid: false, error: "Repository URL is required and must be a string" };
  }

  if (url.length > MAX_URL_LENGTH) {
    return { isValid: false, error: `URL too long (max ${MAX_URL_LENGTH} characters)` };
  }

  if (!SAFE_URL_REGEX.test(url)) {
    return { isValid: false, error: "Invalid repository URL format" };
  }

  return { isValid: true };
}

/**
 * Validate git user object
 */
export function validateGitUser(user: GitUser): ValidationResult {
  const nameValidation = validateGitUsername(user.name);
  if (!nameValidation.isValid) {
    return { isValid: false, error: `Invalid name: ${nameValidation.error}` };
  }

  const emailValidation = validateGitEmail(user.email);
  if (!emailValidation.isValid) {
    return { isValid: false, error: `Invalid email: ${emailValidation.error}` };
  }

  return { isValid: true };
}

/**
 * Sanitize string for shell usage (escape special characters)
 */
export function sanitizeForShell(input: string): string {
  // Remove null bytes and control characters
  let sanitized = input.replace(/[\x00-\x1f\x7f]/g, "");
  
  // Escape shell metacharacters
  sanitized = sanitized.replace(/[;&|`$(){}[\]\\]/g, "\\$&");
  
  return sanitized;
}

/**
 * Log security validation failure
 */
export function logSecurityEvent(event: string, details: Record<string, any>): void {
  logger.warn(`[SECURITY] ${event}`, {
    ...details,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Validate all inputs for a git operation
 */
export function validateGitOperation(params: {
  user?: GitUser;
  branch?: string;
  message?: string;
  repoUrl?: string;
}): ValidationResult {
  if (params.user) {
    const userValidation = validateGitUser(params.user);
    if (!userValidation.isValid) {
      logSecurityEvent("Invalid git user", { user: params.user, error: userValidation.error });
      return userValidation;
    }
  }

  if (params.branch) {
    const branchValidation = validateBranchName(params.branch);
    if (!branchValidation.isValid) {
      logSecurityEvent("Invalid branch name", { branch: params.branch, error: branchValidation.error });
      return branchValidation;
    }
  }

  if (params.message) {
    const messageValidation = validateCommitMessage(params.message);
    if (!messageValidation.isValid) {
      logSecurityEvent("Invalid commit message", { message: params.message.substring(0, 100), error: messageValidation.error });
      return messageValidation;
    }
  }

  if (params.repoUrl) {
    const urlValidation = validateRepoUrl(params.repoUrl);
    if (!urlValidation.isValid) {
      logSecurityEvent("Invalid repository URL", { url: params.repoUrl, error: urlValidation.error });
      return urlValidation;
    }
  }

  return { isValid: true };
}