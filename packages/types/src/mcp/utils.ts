export interface ParsedMCPToolName {
  serverName: string;
  toolName: string;
  displayServerName: string;
  displayToolName: string;
}

const KNOWN_MCP_TOOLS = new Set([
  "context7_resolve_library_id",
  "context7_get_library_docs",
]);

const MCP_TOOL_MAPPINGS: Record<string, string> = {
  context7_resolve_library_id: "context7:resolve-library-id",
  context7_get_library_docs: "context7:get-library-docs",
};

/**
 * Transform MCP tool name from server:tool-name to server_tool_name for LLM compatibility
 * Replaces both colons (:) and hyphens (-) with underscores (_)
 */
export function transformMCPToolName(originalName: string): string {
  const transformed = originalName.replace(/[:-]/g, "_");

  return transformed;
}

export function isOriginalMCPTool(toolName: string): boolean {
  return Object.values(MCP_TOOL_MAPPINGS).includes(toolName);
}

export function isTransformedMCPTool(toolName: string): boolean {
  return KNOWN_MCP_TOOLS.has(toolName);
}

export function isMCPTool(toolName: string): boolean {
  return isOriginalMCPTool(toolName) || isTransformedMCPTool(toolName);
}

export function parseMCPToolName(toolName: string): ParsedMCPToolName | null {
  if (!isMCPTool(toolName)) {
    return null;
  }

  let serverName: string;
  let toolNamePart: string;

  if (toolName.includes(":")) {
    // Original format: server:tool
    const parts = toolName.split(":");
    serverName = parts[0] || "MCP";
    toolNamePart = parts[1] || "Tool";
  } else {
    // Transformed format: server_tool
    const underscoreIndex = toolName.indexOf("_");
    if (underscoreIndex > 0) {
      serverName = toolName.substring(0, underscoreIndex);
      toolNamePart = toolName.substring(underscoreIndex + 1);
    } else {
      return null;
    }
  }

  const displayServerName = serverName
    ? serverName.charAt(0).toUpperCase() + serverName.slice(1)
    : "MCP";

  const displayToolName = toolNamePart
    ? toolNamePart
        .split(/[-_]/)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ")
    : "Tool";

  return {
    serverName,
    toolName: toolNamePart,
    displayServerName,
    displayToolName,
  };
}

export function getOriginalMCPToolName(
  transformedName: string
): string | undefined {
  return MCP_TOOL_MAPPINGS[transformedName];
}

// For frontend tool UI title
export function getMCPToolTitle(
  toolName: string,
  args: Record<string, any> = {}
): string {
  const originalName = getOriginalMCPToolName(toolName) || toolName;

  if (originalName === "context7:resolve-library-id") {
    const libraryName =
      args?.libraryName || args?.library || args?.name || "Unknown";
    return `Find Library "${libraryName}"`;
  }

  if (originalName === "context7:get-library-docs") {
    const libraryID =
      args?.context7CompatibleLibraryID ||
      args?.library ||
      args?.libraryId ||
      "Unknown";
    const topic = args?.topic || args?.query || args?.search || "Documentation";
    return `${libraryID} "${topic}"`;
  }

  const parsed = parseMCPToolName(toolName);
  return parsed ? parsed.displayToolName : toolName;
}

export function getMCPToolPrefix(toolName: string): string {
  const parsed = parseMCPToolName(toolName);
  return parsed ? parsed.displayServerName : "MCP";
}
