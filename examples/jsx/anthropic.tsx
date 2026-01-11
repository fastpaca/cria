/**
 * Example: Using Cria with Anthropic API
 *
 * This example shows how to build a prompt with Cria and render it
 * to Anthropic's message format. System messages are automatically
 * extracted to the separate `system` parameter.
 */

import Anthropic from "@anthropic-ai/sdk";
import { cria, Message, ToolCall, ToolResult } from "@fastpaca/cria";
import { anthropic } from "@fastpaca/cria/anthropic";

// Your tokenizer (use a proper tokenizer in production)
const tokenizer = (text: string) => Math.ceil(text.length / 4);

// Build your prompt with the DSL
const assistantToolCall = Message({
  messageRole: "assistant",
  priority: 1,
  children: [
    ToolCall({
      input: { city: "Paris" },
      priority: 1,
      toolCallId: "call_123",
      toolName: "getWeather",
    }),
  ],
});

const toolResultMessage = Message({
  messageRole: "user",
  priority: 1,
  children: [
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
  .user("What's the weather in Paris?")
  .raw(assistantToolCall)
  .raw(toolResultMessage)
  .user("Should I bring a jacket?");

async function main() {
  // Render to Anthropic format
  // Note: system message is extracted separately
  const { system, messages } = await prompt.render({
    tokenizer,
    budget: 200_000,
    renderer: anthropic,
  });

  console.log("=== System ===");
  console.log(system);

  console.log("\n=== Messages ===");
  console.log(JSON.stringify(messages, null, 2));

  // Use with Anthropic SDK
  const client = new Anthropic();
  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1024,
    system,
    messages,
  });

  console.log("\n=== AI Response ===");
  console.log(
    response.content[0]?.type === "text" ? response.content[0].text : response
  );
}

main().catch(console.error);
