/**
 * Cria Provider Cache Pinning Example
 *
 * Shows how to use pin() to mark prompt prefixes for provider-level caching.
 * The cache_id is forwarded to OpenAI's prompt_cache_key for efficient reuse.
 */

import { cria } from "@fastpaca/cria";
import { OpenAIChatProvider } from "@fastpaca/cria/openai";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = "gpt-4o-mini";
const provider = new OpenAIChatProvider(openai, MODEL);

// Pin a prompt prefix with cache metadata
const pinnedPrefix = cria.prompt().system("You are a helpful assistant.").pin({
  id: "system",
  version: "v1",
  scopeKey: "tenant:acme",
  ttlSeconds: 3600,
});

const prompt = cria.prompt(provider).prefix(pinnedPrefix).user("Hello!");
const { messages, cache_id } = await prompt.render();

console.log("=== Messages ===");
console.log(JSON.stringify(messages, null, 2));
console.log(`\n=== Cache ID: ${cache_id ?? "none"} ===\n`);

const completion = await openai.chat.completions.create({
  model: MODEL,
  messages,
  ...(cache_id ? { prompt_cache_key: cache_id } : {}),
});

console.log("=== OpenAI Response ===");
console.log(completion.choices[0]?.message?.content);
