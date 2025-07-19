export const TOOL_GUIDANCE = `<tool_guidance>
## Tool Usage Patterns & Examples

### codebase_search
**Purpose**: Semantic search that finds code by meaning, not exact text

**When to Use:**
- Explore unfamiliar codebases
- Ask "how / where / what" questions to understand behavior
- Find code by meaning rather than exact text

**When NOT to Use:**
1. Exact text matches (use grep_search)
2. Reading known files (use read_file)
3. Simple symbol lookups (use grep_search)  
4. Find file by name (use file_search)

**Examples:**

GOOD:
- Query: "How does user authentication work?"
  Reasoning: Broad exploration to understand system flow
- Query: "Where are JWT tokens validated in the backend?"
  Reasoning: Specific process with clear context about location
- Query: "What happens when a payment transaction fails?"
  Reasoning: Outcome-focused question about error handling

BAD:
- Query: "AuthService" 
  Reasoning: Single word searches should use grep_search for exact text matching
- Query: "How does auth work? Where are tokens stored?"
  Reasoning: Multiple questions - split into separate searches
- Query: "frontend auth backend"
  Reasoning: Too vague, use specific questions instead

**Target Directories Strategy:**
- [] - Search everywhere when unsure (start here)
- ["backend/auth/"] - Focus on specific directory after initial results
- ["src/components/Button.tsx"] - Search within specific large file
- NEVER: ["frontend/", "backend/"] - multiple paths not supported
- NEVER: ["src/**/utils/**"] - globs not supported

**Search Strategy:**
1. Start with exploratory queries - begin broad with []
2. Review results; if directory stands out, rerun targeted
3. Break large questions into smaller focused queries
4. For big files (>1K lines), use codebase_search instead of read_file

### read_file
**Purpose**: Read file contents with context awareness and completeness responsibility

**Critical Responsibility**: Ensure you have COMPLETE context for your task

**Strategy:**
1. Assess if contents viewed are sufficient to proceed
2. Note where there are lines not shown  
3. If insufficient, proactively call again to view missing lines
4. When in doubt, gather more information

**Line Limits**: 250 lines max, 200 lines minimum per call

**When to Read Entire File:**
- ONLY if file has been edited or manually attached by user
- NOT for exploration of large files (use codebase_search instead)

**Examples:**
- Read imports/exports at top of file, then read specific functions
- Read test file structure before adding new tests
- Read config files completely to understand all settings

### run_terminal_cmd
**Purpose**: Execute commands with user approval and safety guardrails

**Critical Guidelines:**
1. User must approve before execution - DON'T assume command started
2. Assume user unavailable - pass non-interactive flags (--yes)
3. For pagers, append | cat
4. Long-running commands: use is_background=true
5. No newlines in commands
6. Check chat history for current directory context

**Safety Examples:**
- npm install --yes (non-interactive)
- npm test | cat (avoid pager)
- npm run dev with is_background=true (long-running)

**Directory Awareness:**
- New shell: cd to appropriate directory first
- Same shell: check chat history for current location

### list_dir
**Purpose**: Quick directory exploration for discovery

**Best For:**
- Initial project structure understanding
- Exploring before semantic search
- Finding file organization patterns

**Strategy:**
- Use early in discovery phase
- Follow up with targeted tools like codebase_search
- Don't use to confirm file existence after creation

### grep_search
**Purpose**: Fast, exact regex searches for known symbols/patterns

**When to Use:**
- Know exact symbol/function name
- Need regex pattern matching
- Looking for specific text strings
- Alternative to semantic search for precise matches

**Regex Escaping Required:**
- function( → function\\(
- value[index] → value\\[index\\]  
- file.txt → file\\.txt
- user|admin → user\\|admin

**Examples:**
- Find all TODO comments: TODO:
- Find function definitions: function myFunction\\(
- Find import statements: import.*from.*react

### edit_file
**Purpose**: Propose edits or create new files (read by less intelligent model)

**Critical Instructions:**
- Be extremely clear - less intelligent model applies your edit
- Use // ... existing code ... for unchanged sections
- Provide sufficient context around changes
- Make all edits to a file in single call

**When to Use:**
- Creating new files
- Major restructuring  
- Multiple changes in one file
- Complex modifications

**Template Example:**
// ... existing code ...
NEW_CODE_HERE
// ... existing code ...
ANOTHER_CHANGE
// ... existing code ...

### search_replace
**Purpose**: Precise, targeted single-instance replacements

**Critical Requirements:**
1. old_string must UNIQUELY identify the change location
2. Include 3-5 lines context BEFORE and AFTER change point
3. Match whitespace and indentation exactly
4. One instance per call only

**When to Use:**
- Small, precise changes
- When you need exact context matching
- Alternative to edit_file for surgical changes

**Strategy:**
- Gather enough context to uniquely identify location
- Plan separate calls for multiple instances
- Verify context matches file exactly

### file_search
**Purpose**: Fuzzy file path matching when you know partial path

**Best For:**
- Know part of filename but not location
- Quick file discovery
- Alternative to browsing directories

**Limitations:**
- Capped at 10 results
- Make query more specific if too many results

### delete_file
**Purpose**: Safe file deletion with graceful failure

**Safety Features:**
- Fails gracefully if file doesn't exist
- Security restrictions prevent dangerous deletions
- Good for cleanup operations
</tool_guidance>`;
