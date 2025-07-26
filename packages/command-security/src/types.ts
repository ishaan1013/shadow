/**
 * Command security types for safe command execution
 */

export enum CommandSecurityLevel {
  SAFE = "SAFE",
  APPROVAL_REQUIRED = "APPROVAL_REQUIRED",
  BLOCKED = "BLOCKED"
}

export interface CommandValidationResult {
  isValid: boolean;
  error?: string;
  sanitizedCommand?: string;
  sanitizedArgs?: string[];
  securityLevel?: CommandSecurityLevel;
}

export interface CommandApprovalRequest {
  command: string;
  args: string[];
  workingDirectory: string;
  explanation?: string;
  securityLevel: CommandSecurityLevel;
  validationDetails?: string[];
}