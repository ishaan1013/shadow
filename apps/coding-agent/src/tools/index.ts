import { tool } from 'ai';
import { z } from 'zod';
import * as fs from 'fs-extra';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { glob } from 'glob';
import simpleGit from 'simple-git';

const execAsync = promisify(exec);

export const tools = {
  codebase_search: tool({
    description: 'Find snippets of code from the codebase most relevant to the search query. This is a semantic search tool, so the query should ask for something semantically matching what is needed.',
    parameters: z.object({
      query: z.string().describe('The search query to find relevant code'),
      target_directories: z.array(z.string()).optional().describe('Glob patterns for directories to search over'),
      explanation: z.string().describe('One sentence explanation as to why this tool is being used'),
    }),
    execute: async ({ query, target_directories = [], explanation }) => {
      // For now, implement a simple file search with grep as a placeholder
      // In a real implementation, this would use semantic search with embeddings
      console.log(`🔍 ${explanation}`);
      try {
        const searchPattern = target_directories.length > 0 ? target_directories.join(' ') : '.';
        const { stdout } = await execAsync(`find ${searchPattern} -type f -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx" | head -20`);
        const files = stdout.trim().split('\n').filter(f => f);
        
        let results = [];
        for (const file of files.slice(0, 5)) {
          try {
            const content = await fs.readFile(file, 'utf-8');
            if (content.toLowerCase().includes(query.toLowerCase())) {
              results.push({
                file,
                snippet: content.substring(0, 200) + '...',
                relevance: 'High'
              });
            }
          } catch (err) {
            // Skip files that can't be read
          }
        }
        
        return {
          results: results.length > 0 ? results : [{ message: 'No relevant code found for the query' }],
          query,
          target_directories
        };
      } catch (error) {
        return { error: `Search failed: ${error}` };
      }
    }
  }),

  read_file: tool({
    description: 'Read the contents of a file with optional line range specification',
    parameters: z.object({
      target_file: z.string().describe('The path of the file to read'),
      should_read_entire_file: z.boolean().default(false).describe('Whether to read the entire file'),
      start_line_one_indexed: z.number().optional().describe('The one-indexed line number to start reading from'),
      end_line_one_indexed_inclusive: z.number().optional().describe('The one-indexed line number to end reading at (inclusive)'),
      explanation: z.string().describe('One sentence explanation as to why this tool is being used'),
    }),
    execute: async ({ target_file, should_read_entire_file, start_line_one_indexed, end_line_one_indexed_inclusive, explanation }) => {
      console.log(`📖 ${explanation}`);
      try {
        const content = await fs.readFile(target_file, 'utf-8');
        const lines = content.split('\n');
        
        if (should_read_entire_file) {
          return {
            content,
            file: target_file,
            total_lines: lines.length
          };
        }
        
        const startLine = start_line_one_indexed || 1;
        const endLine = end_line_one_indexed_inclusive || lines.length;
        
        const selectedLines = lines.slice(startLine - 1, endLine);
        
        return {
          content: selectedLines.join('\n'),
          file: target_file,
          lines: `${startLine}-${endLine}`,
          total_lines: lines.length,
          showing_lines: selectedLines.length
        };
      } catch (error) {
        return { error: `Failed to read file: ${error}` };
      }
    }
  }),

  run_terminal_cmd: tool({
    description: 'Execute a terminal command. Commands will be executed in the workspace directory.',
    parameters: z.object({
      command: z.string().describe('The terminal command to execute'),
      is_background: z.boolean().default(false).describe('Whether the command should be run in the background'),
      explanation: z.string().describe('One sentence explanation as to why this command needs to be run'),
    }),
    execute: async ({ command, is_background, explanation }) => {
      console.log(`🔧 ${explanation}`);
      console.log(`Running: ${command}`);
      
      try {
        if (is_background) {
          // For background processes, we'll just start them and return immediately
          exec(command, { cwd: process.cwd() });
          return { 
            message: `Background command started: ${command}`,
            command,
            background: true
          };
        } else {
          const { stdout, stderr } = await execAsync(command, { 
            cwd: process.cwd(),
            maxBuffer: 1024 * 1024 // 1MB buffer
          });
          return { 
            stdout: stdout || '', 
            stderr: stderr || '', 
            command,
            background: false
          };
        }
      } catch (error: any) {
        return { 
          error: `Command failed: ${error.message}`,
          stdout: error.stdout || '',
          stderr: error.stderr || '',
          command
        };
      }
    }
  }),

  list_dir: tool({
    description: 'List the contents of a directory',
    parameters: z.object({
      relative_workspace_path: z.string().describe('Path to list contents of, relative to the workspace root'),
      explanation: z.string().describe('One sentence explanation as to why this tool is being used'),
    }),
    execute: async ({ relative_workspace_path, explanation }) => {
      console.log(`📁 ${explanation}`);
      try {
        const fullPath = path.resolve(process.cwd(), relative_workspace_path);
        const items = await fs.readdir(fullPath, { withFileTypes: true });
        
        const contents = items.map(item => ({
          name: item.name,
          type: item.isDirectory() ? 'directory' : 'file',
          path: path.join(relative_workspace_path, item.name)
        }));
        
        return {
          path: relative_workspace_path,
          contents,
          total_items: contents.length
        };
      } catch (error) {
        return { error: `Failed to list directory: ${error}` };
      }
    }
  }),

  edit_file: tool({
    description: 'Create a new file or edit an existing file with the provided content',
    parameters: z.object({
      target_file: z.string().describe('The target file to modify or create'),
      code_edit: z.string().describe('The complete content for the file or the edits to make'),
      instructions: z.string().describe('A description of what changes are being made'),
    }),
    execute: async ({ target_file, code_edit, instructions }) => {
      console.log(`✏️ ${instructions}`);
      try {
        // Ensure directory exists
        const dir = path.dirname(target_file);
        await fs.ensureDir(dir);
        
        // Write the file
        await fs.writeFile(target_file, code_edit, 'utf-8');
        
        return {
          file: target_file,
          message: `File ${target_file} has been updated`,
          instructions
        };
      } catch (error) {
        return { error: `Failed to edit file: ${error}` };
      }
    }
  }),

  file_search: tool({
    description: 'Search for files by name using fuzzy matching',
    parameters: z.object({
      query: z.string().describe('Fuzzy filename to search for'),
      explanation: z.string().describe('One sentence explanation as to why this tool is being used'),
    }),
    execute: async ({ query, explanation }) => {
      console.log(`🔎 ${explanation}`);
      try {
        const pattern = `**/*${query}*`;
        const files = await glob(pattern, { 
          ignore: ['node_modules/**', '.git/**', 'dist/**', 'build/**'],
          maxDepth: 10
        });
        
        return {
          query,
          files: files.slice(0, 10), // Limit to 10 results
          total_found: files.length
        };
      } catch (error) {
        return { error: `File search failed: ${error}` };
      }
    }
  }),

  grep_search: tool({
    description: 'Search for text patterns in files using regex',
    parameters: z.object({
      query: z.string().describe('The regex pattern to search for'),
      include_pattern: z.string().optional().describe('Glob pattern for files to include'),
      exclude_pattern: z.string().optional().describe('Glob pattern for files to exclude'),
      case_sensitive: z.boolean().default(false).describe('Whether the search should be case sensitive'),
      explanation: z.string().describe('One sentence explanation as to why this tool is being used'),
    }),
    execute: async ({ query, include_pattern, exclude_pattern, case_sensitive, explanation }) => {
      console.log(`🔍 ${explanation}`);
      try {
        let command = `grep -r ${case_sensitive ? '' : '-i'} -n "${query}"`;
        
        if (include_pattern) {
          command += ` --include="${include_pattern}"`;
        }
        if (exclude_pattern) {
          command += ` --exclude="${exclude_pattern}"`;
        }
        
        command += ' .';
        
        const { stdout, stderr } = await execAsync(command, { 
          cwd: process.cwd(),
          maxBuffer: 1024 * 1024 
        });
        
        const matches = stdout.split('\n').filter(line => line.trim()).slice(0, 50);
        
        return {
          query,
          matches,
          total_matches: matches.length,
          case_sensitive,
          include_pattern,
          exclude_pattern
        };
      } catch (error: any) {
        // grep returns non-zero exit code when no matches found
        if (error.code === 1) {
          return {
            query,
            matches: [],
            total_matches: 0,
            message: 'No matches found'
          };
        }
        return { error: `Grep search failed: ${error.message}` };
      }
    }
  }),

  delete_file: tool({
    description: 'Delete a file at the specified path',
    parameters: z.object({
      target_file: z.string().describe('The path of the file to delete'),
      explanation: z.string().describe('One sentence explanation as to why this tool is being used'),
    }),
    execute: async ({ target_file, explanation }) => {
      console.log(`🗑️ ${explanation}`);
      try {
        await fs.remove(target_file);
        return {
          file: target_file,
          message: `File ${target_file} has been deleted`
        };
      } catch (error) {
        return { error: `Failed to delete file: ${error}` };
      }
    }
  })
};