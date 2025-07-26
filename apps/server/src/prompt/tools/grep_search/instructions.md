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