import { exec } from "child_process";
import { promises as fs } from "fs";
import * as path from "path";
import { promisify } from "util";

const execAsync = promisify(exec);

export interface ToolResult {
  success: boolean;
  result?: string;
  error?: string;
}

export class ToolExecutor {
  private workspaceRoot: string;

  constructor(workspaceRoot: string = "/workspace") {
    this.workspaceRoot = workspaceRoot;
  }

  async executeTool(toolName: string, args: Record<string, any>): Promise<ToolResult> {
    try {
      switch (toolName) {
        case "read_file":
          return await this.readFile(args as any);
        case "edit_file":
          return await this.editFile(args as any);
        case "search_replace":
          return await this.searchReplace(args as any);
        case "list_dir":
          return await this.listDir(args as any);
        case "file_search":
          return await this.fileSearch(args as any);
        case "grep_search":
          return await this.grepSearch(args as any);
        case "run_terminal_cmd":
          return await this.runTerminalCmd(args as any);
        case "delete_file":
          return await this.deleteFile(args as any);
        case "codebase_search":
          return await this.codebaseSearch(args as any);
        default:
          return {
            success: false,
            error: `Unknown tool: ${toolName}`,
          };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error occurred",
      };
    }
  }

  private async readFile(args: {
    target_file: string;
    start_line_one_indexed?: number;
    end_line_one_indexed_inclusive?: number;
    should_read_entire_file?: boolean;
  }): Promise<ToolResult> {
    const filePath = this.resolvePath(args.target_file);

    try {
      const content = await fs.readFile(filePath, "utf-8");
      const lines = content.split("\n");

      if (args.should_read_entire_file) {
        return {
          success: true,
          result: `Contents of ${args.target_file}:\n${content}`,
        };
      }

      const start = args.start_line_one_indexed || 1;
      const end = args.end_line_one_indexed_inclusive || lines.length;

      const selectedLines = lines.slice(start - 1, end);
      const totalLines = lines.length;

      let result = `Contents of ${args.target_file}, lines ${start}-${end} (total ${totalLines} lines):\n`;
      result += selectedLines.map((line, i) => `${start + i}: ${line}`).join("\n");

      if (start > 1) {
        result = `Lines 1-${start - 1} omitted...\n` + result;
      }
      if (end < totalLines) {
        result += `\nLines ${end + 1}-${totalLines} omitted...`;
      }

      return { success: true, result };
    } catch (error) {
      return {
        success: false,
        error: `Failed to read file: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  private async editFile(args: {
    target_file: string;
    code_edit: string;
  }): Promise<ToolResult> {
    const filePath = this.resolvePath(args.target_file);

    try {
      // Create directory if it doesn't exist
      const dir = path.dirname(filePath);
      await fs.mkdir(dir, { recursive: true });

      // Write the new content
      await fs.writeFile(filePath, args.code_edit, "utf-8");

      return {
        success: true,
        result: `Successfully edited ${args.target_file}`,
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to edit file: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  private async searchReplace(args: {
    file_path: string;
    old_string: string;
    new_string: string;
  }): Promise<ToolResult> {
    const filePath = this.resolvePath(args.file_path);

    try {
      const content = await fs.readFile(filePath, "utf-8");
      
      if (!content.includes(args.old_string)) {
        return {
          success: false,
          error: `Old string not found in file: ${args.old_string}`,
        };
      }

      const newContent = content.replace(args.old_string, args.new_string);
      await fs.writeFile(filePath, newContent, "utf-8");

      return {
        success: true,
        result: `Successfully replaced text in ${args.file_path}`,
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to perform search and replace: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  private async listDir(args: {
    relative_workspace_path: string;
  }): Promise<ToolResult> {
    const dirPath = this.resolvePath(args.relative_workspace_path);

    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      
      const result = entries
        .map((entry) => {
          const type = entry.isDirectory() ? "[dir]" : "[file]";
          return `${type} ${entry.name}`;
        })
        .join("\n");

      return {
        success: true,
        result: `Contents of ${args.relative_workspace_path}:\n${result}`,
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to list directory: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  private async fileSearch(args: {
    query: string;
  }): Promise<ToolResult> {
    try {
      // Use find command to search for files
      const { stdout } = await execAsync(
        `find ${this.workspaceRoot} -type f -name "*${args.query}*" | head -10`,
        { cwd: this.workspaceRoot }
      );

      return {
        success: true,
        result: `Files matching "${args.query}":\n${stdout.trim() || "No files found"}`,
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to search files: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  private async grepSearch(args: {
    query: string;
    include_pattern?: string;
    exclude_pattern?: string;
    case_sensitive?: boolean;
  }): Promise<ToolResult> {
    try {
      let cmd = `grep -r -n`;
      
      if (!args.case_sensitive) {
        cmd += " -i";
      }

      if (args.include_pattern) {
        cmd += ` --include="${args.include_pattern}"`;
      }

      if (args.exclude_pattern) {
        cmd += ` --exclude="${args.exclude_pattern}"`;
      }

      cmd += ` "${args.query}" ${this.workspaceRoot} | head -50`;

      const { stdout } = await execAsync(cmd, { cwd: this.workspaceRoot });

      return {
        success: true,
        result: `Search results for "${args.query}":\n${stdout.trim() || "No matches found"}`,
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to search: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  private async runTerminalCmd(args: {
    command: string;
    is_background?: boolean;
  }): Promise<ToolResult> {
    try {
      if (args.is_background) {
        // Start background process
        exec(args.command, { cwd: this.workspaceRoot });
        return {
          success: true,
          result: `Started background command: ${args.command}`,
        };
      } else {
        const { stdout, stderr } = await execAsync(args.command, { 
          cwd: this.workspaceRoot,
          timeout: 30000 // 30 second timeout
        });

        let result = `Command: ${args.command}\n`;
        if (stdout) result += `Output:\n${stdout}`;
        if (stderr) result += `Error:\n${stderr}`;

        return { success: true, result };
      }
    } catch (error) {
      return {
        success: false,
        error: `Command failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  private async deleteFile(args: {
    target_file: string;
  }): Promise<ToolResult> {
    const filePath = this.resolvePath(args.target_file);

    try {
      await fs.unlink(filePath);
      return {
        success: true,
        result: `Successfully deleted ${args.target_file}`,
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to delete file: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  private async codebaseSearch(args: {
    query: string;
    target_directories?: string[];
  }): Promise<ToolResult> {
    try {
      // For now, implement as a combination of grep and find
      // In a production system, this would use vector search or semantic search
      
      const searchPaths = args.target_directories && args.target_directories.length > 0 
        ? args.target_directories.map(dir => this.resolvePath(dir)).join(" ")
        : this.workspaceRoot;

      // Search for the query in code files
      const { stdout } = await execAsync(
        `grep -r -n -i --include="*.ts" --include="*.js" --include="*.tsx" --include="*.jsx" --include="*.py" --include="*.java" --include="*.cpp" --include="*.h" "${args.query}" ${searchPaths} | head -20`,
        { cwd: this.workspaceRoot }
      );

      return {
        success: true,
        result: `Codebase search results for "${args.query}":\n${stdout.trim() || "No matches found"}`,
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to search codebase: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  private resolvePath(relativePath: string): string {
    // Handle both relative and absolute paths
    if (path.isAbsolute(relativePath)) {
      return relativePath;
    }
    return path.resolve(this.workspaceRoot, relativePath);
  }
}