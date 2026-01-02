/**
 * Example: Using Cria with Anthropic API
 *
 * This example shows how to build a prompt with Cria and render it
 * to Anthropic's message format. System messages are automatically
 * extracted to the separate `system` parameter.
 */

import Anthropic from "@anthropic-ai/sdk";
import { Message, Region, render, ToolCall, ToolResult } from "@fastpaca/cria";
import { anthropic } from "@fastpaca/cria/anthropic";

// Your tokenizer (use a proper tokenizer in production)
const tokenizer = (text: string) => Math.ceil(text.length / 4);

// Build your prompt with Cria components
const prompt = (
  <Region priority={0}>
    <Message messageRole="system">You are a helpful weather assistant.</Message>
    <Message messageRole="user">What's the weather in Paris?</Message>
    <Message messageRole="assistant">
      <ToolCall
        input={{ city: "Paris" }}
        priority={1}
        toolCallId="call_123"
        toolName="getWeather"
      />
    </Message>
    <Message messageRole="user">
      <ToolResult
        output={{ temperature: 18, condition: "sunny" }}
        priority={1}
        toolCallId="call_123"
        toolName="getWeather"
      />
    </Message>
    <Message messageRole="user">Should I bring a jacket?</Message>
  </Region>
);

async function main() {
  // Render to Anthropic format
  // Note: system message is extracted separately
  const { system, messages } = await render(prompt, {
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
