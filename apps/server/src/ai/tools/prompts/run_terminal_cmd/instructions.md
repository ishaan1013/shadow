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