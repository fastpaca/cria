/**
 * Example: Using Cria with OpenAI Chat Completions API
 *
 * This example shows how to build a prompt with Cria and render it
 * to ChatCompletionMessageParam[] for use with the OpenAI SDK.
 */

import { cria, Message, ToolCall, ToolResult } from "@fastpaca/cria";
import { createProvider } from "@fastpaca/cria/openai";
import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const provider = createProvider(client, "gpt-5");

// Build your prompt with the DSL; use a raw assistant message to include tool calls/results
const assistantWithTools = Message({
  messageRole: "assistant",
  priority: 1,
  children: [
    ToolCall({
      input: { city: "Paris" },
      priority: 1,
      toolCallId: "call_123",
      toolName: "getWeather",
    }),
    ToolResult({
      output: { temperature: 18, condition: "sunny" },
      priority: 1,
      toolCallId: "call_123",
      toolName: "getWeather",
    }),
  ],
});

const prompt = cria
  .prompt()
  .system("You are a helpful weather assistant.")
  .user("What's the weather in Paris? Should I bring a jacket?")
  .raw(assistantWithTools);

async function main() {
  // Render to OpenAI Chat Completions format
  const messages = await prompt.render({
    provider,
    budget: 128_000,
  });

  console.log("=== Rendered Messages ===");
  console.log(JSON.stringify(messages, null, 2));
  console.log(
    `=== Token count: ${provider.countTokens(messages)} / 128000 ===`
  );

  // Use with OpenAI SDK
  const response = await client.chat.completions.create({
    model: "gpt-5",
    messages,
  });

  console.log("\n=== AI Response ===");
  console.log(response.choices[0]?.message.content);
}

main().catch(console.error);
