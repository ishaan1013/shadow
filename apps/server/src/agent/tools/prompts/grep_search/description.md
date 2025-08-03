# Instructions

This is best for finding exact text matches or regex patterns.
This is preferred over semantic search when we know the exact symbol/function name/etc. to search in some set of directories/file types.

Use this tool to run fast, exact regex searches over text files using the `ripgrep` engine.
To avoid overwhelming output, the results are capped at 50 matches.
Use the include or exclude patterns to filter the search scope by file type or specific paths.

- Always escape special regex characters: ( ) [ ] { } + * ? ^ $ | . \
- Use `\` to escape any of these characters when they appear in your search string.
- Do NOT perform fuzzy or semantic matches.
- Return only a valid regex pattern string.

## Examples

| Literal               | Regex Pattern            |
|-----------------------|--------------------------|
| function(             | function\\(              |
| value[index]          | value\\[index\\]         |
| file.txt               | file\\.txt                |
| user|admin            | user\\|admin             |
| path\\to\\file         | path\\\\to\\\\file        |
| hello world           | hello world              |
| foo\\(bar\\)          | foo\\\\(bar\\\\)         |