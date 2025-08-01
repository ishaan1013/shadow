**Purpose**: Read file contents with context awareness and completeness responsibility

**Critical Responsibility**: Ensure you have COMPLETE context for your task
**Path Requirement**: Always use relative paths from workspace root, not absolute paths

**Strategy:**
1. Assess if contents viewed are sufficient to proceed
2. Note where there are lines not shown  
3. If insufficient, proactively call again to view missing lines
4. When in doubt, gather more information

**Line Limits**: 250 lines max, 200 lines minimum per call

**When to Read Entire File:**
- ONLY if file has been edited or manually attached by user
- NOT for exploration of large files (use semantic_search for understanding concepts or grep_search for finding specific terms)

**Examples:**
- Read imports/exports at top of file, then read specific functions
- Read test file structure before adding new tests
- Read config files completely to understand all settings