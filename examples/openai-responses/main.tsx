/**
 * Example: Using Cria with OpenAI Responses API (reasoning models)
 *
 * This example shows how to build a prompt and render it to
 * ResponseInputItem[] for use with the OpenAI Responses API.
 *
 * Note: The Reasoning component is used to replay reasoning from previous
 * API responses. For fresh requests, the model generates its own reasoning.
 */

import { Message, Region, render, ToolCall, ToolResult } from "@fastpaca/cria";
import { responses } from "@fastpaca/cria/openai";
import OpenAI from "openai";

// Your tokenizer (use tiktoken in production for accurate counts)
const tokenizer = (text: string) => Math.ceil(text.length / 4);

// Build your prompt with Cria components
const prompt = (
  <Region priority={0}>
    {/* biome-ignore lint/a11y/useValidAriaRole: Message role is an LLM role, not ARIA */}
    <Message role="system">You are a helpful weather assistant.</Message>
    {/* biome-ignore lint/a11y/useValidAriaRole: Message role is an LLM role, not ARIA */}
    <Message role="user">
      What's the weather in Paris? Should I bring a jacket?
    </Message>
    <ToolCall
      input={{ city: "Paris" }}
      priority={1}
      toolCallId="call_abc123"
      toolName="getWeather"
    />
    <ToolResult
      output={{ temperature: 18, condition: "sunny" }}
      priority={1}
      toolCallId="call_abc123"
      toolName="getWeather"
    />
  </Region>
);

async function main() {
  // Render to OpenAI Responses format
  const input = await render(prompt, {
    tokenizer,
    budget: 128_000,
    renderer: responses,
  });

  console.log("=== Rendered Input ===");
  console.log(JSON.stringify(input, null, 2));

  // Use with OpenAI SDK (Responses API)
  const openai = new OpenAI();
  const response = await openai.responses.create({
    model: "gpt-5",
    input,
  });

  console.log("\n=== AI Response ===");
  console.log(response.output_text);
}

main().catch(console.error);
