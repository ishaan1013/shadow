import { readFileSync } from "fs";
import { join, dirname } from "path";

// Helper function to read tool instruction files
function readToolInstructions(toolName: string): string {
  const instructionsPath = join(dirname(__filename), toolName, 'instructions.md');
  return readFileSync(instructionsPath, 'utf-8').trim();
}

// Generate TOOL_GUIDANCE from individual instruction files
export const TOOL_GUIDANCE = `<tool_guidance>
## Tool Usage Patterns & Examples

### todo_write
${readToolInstructions('todo_write')}

### read_file
${readToolInstructions('read_file')}

### run_terminal_cmd
${readToolInstructions('run_terminal_cmd')}

### list_dir
${readToolInstructions('list_dir')}

### grep_search
${readToolInstructions('grep_search')}

### edit_file
${readToolInstructions('edit_file')}

### search_replace
${readToolInstructions('search_replace')}

### file_search
${readToolInstructions('file_search')}

### delete_file
${readToolInstructions('delete_file')}

### semantic_search
${readToolInstructions('semantic_search')}

### web_search
${readToolInstructions('web_search')}
</tool_guidance>`;