Use this tool to propose a search and replace operation on an existing file.

The tool will replace ONE occurrence of old_string with new_string in the specified file.

## Critical Requirements for Using This Tool

1. **UNIQUENESS**: The old_string MUST uniquely identify the specific instance you want to change. This means:
   - Include AT LEAST 3-5 lines of context BEFORE the change point
   - Include AT LEAST 3-5 lines of context AFTER the change point
   - Include all whitespace, indentation, and surrounding code exactly as it appears in the file

2. **SINGLE INSTANCE**: This tool can only change ONE instance at a time. If you need to change multiple instances:
   - Make separate calls to this tool for each instance
   - Each call must uniquely identify its specific instance using extensive context

3. **VERIFICATION**: Before using this tool:
   - If multiple instances exist, gather enough context to uniquely identify each one
   - Plan separate tool calls for each instance