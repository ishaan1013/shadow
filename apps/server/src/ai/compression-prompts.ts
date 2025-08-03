/**
 * Prompts for message compression at different levels
 */

export const LIGHT_COMPRESSION_PROMPT = `You are a summarizer compressing a long assistant message that may include:
- technical explanations
- tool calls (e.g. readFile, writeFile, searchReplace, executeCommand)
- tool results and outputs
- assistant thoughts and planning steps

Summarize the message into a well-structured, readable summary of 6–8 sentences.
Your summary must preserve:
- key code actions (e.g. edits, searches, test runs)
- filenames, paths, search queries, and command strings
- outcome of each tool call (e.g. "replaced 3 matches", "test failed", etc)
- assistant’s reasoning and next planned steps (if present)

Avoid including full stack traces or logs unless very short. Format clearly.

Original content:
{content}

Summary (6–8 sentences):`;

export const LIGHT_COMPRESSION_SYSTEM_PROMPT = `You are a helpful assistant that summarizes coding agent messages. Keep critical technical actions, decisions, tool usage, and plans. Output must be 6–8 clear sentences.`;

export const HEAVY_COMPRESSION_PROMPT = `You are summarizing a long assistant message that includes explanations, tool calls, and tool outputs. Your goal is to compress this into an ultra-short form: 1–3 tightly written sentences.

Keep only:
- the essential code changes or actions taken
- filenames, commands, or search queries used
- the final result or current status

Do NOT include minor details, logs, intermediate steps, or full tool output. Focus on outcome and high-level flow.

Original content:
{content}

Ultra-concise summary (1–3 sentences):`;

export const HEAVY_COMPRESSION_SYSTEM_PROMPT = `You are an expert summarizer that produces ultra-compact summaries of coding assistant messages. Only include high-impact actions, filenames, tool usage, and final outcome. Always output exactly 1–3 sentences.`;
