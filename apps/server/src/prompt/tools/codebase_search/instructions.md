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