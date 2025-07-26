import type { MessageMetadata } from '../chat/messages';
import type {
  WriteResult,
  CommandResult,
  FileResult,
  ToolResultTypes
} from './results';

// Type-safe accessor for tool results
export function getToolResult<T extends ToolResultTypes['toolName']>(
  toolMeta: MessageMetadata['tool'] | undefined,
  toolName: T
): any | null {
  if (!toolMeta?.result || toolMeta.name !== toolName) return null;

  try {
    // Handle both new object format and legacy JSON strings
    const result = typeof toolMeta.result === 'string'
      ? JSON.parse(toolMeta.result)
      : toolMeta.result;

    return result;
  } catch (error) {
    console.warn(`Failed to parse tool result for ${toolName}:`, error);
    return null;
  }
}

// Type guards for runtime validation
export function isEditFileResult(result: unknown): result is WriteResult {
  return typeof result === 'object' && result !== null &&
    'success' in result && 'message' in result &&
    ('isNewFile' in result || 'linesAdded' in result || 'linesRemoved' in result);
}

export function isCommandResult(result: unknown): result is CommandResult {
  return typeof result === 'object' && result !== null &&
    'success' in result && 'message' in result &&
    ('stdout' in result || 'stderr' in result || 'command' in result);
}

export function isFileResult(result: unknown): result is FileResult {
  return typeof result === 'object' && result !== null &&
    'success' in result && 'message' in result &&
    ('content' in result || 'totalLines' in result);
}