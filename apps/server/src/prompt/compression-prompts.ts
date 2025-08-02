/**
 * Prompts for message compression at different levels
 */

export const LIGHT_COMPRESSION_PROMPT = `Please summarize the following message content in exactly 6-8 clear, informative sentences. Preserve all key technical details, important decisions, specific code changes, tool results, and essential context. Be comprehensive but concise:

{content}

Summary (6-8 sentences):`;

export const LIGHT_COMPRESSION_SYSTEM_PROMPT = `You are a helpful assistant that summarizes technical content while preserving important details. Always provide exactly 6-8 sentences.`;

export const HEAVY_COMPRESSION_PROMPT = `Please summarize the following message content in exactly 1-3 sentences, preserving only the most essential information, key decisions, and critical outcomes. Be extremely concise:

{content}

Ultra-concise summary (1-3 sentences):`;

export const HEAVY_COMPRESSION_SYSTEM_PROMPT = `You are a helpful assistant that creates ultra-concise summaries. Always provide exactly 1-3 sentences focusing on the most critical information only.`;