/**
 * Example: Using Cria with OpenAI Chat Completions API
 *
 * This example shows how to build a prompt with Cria and render it
 * to ChatCompletionMessageParam[] for use with the OpenAI SDK.
 */

import { Message, Region, render, ToolCall, ToolResult } from "@fastpaca/cria";
import { chatCompletions } from "@fastpaca/cria/openai";
import OpenAI from "openai";

// Your tokenizer (use tiktoken in production for accurate counts)
const tokenizer = (text: string) => Math.ceil(text.length / 4);

// Build your prompt with Cria components
const prompt = (
  <Region priority={0}>
    <Message messageRole="system">You are a helpful weather assistant.</Message>
    <Message messageRole="user">
      What's the weather in Paris? Should I bring a jacket?
    </Message>
    <Message messageRole="assistant">
      <ToolCall
        input={{ city: "Paris" }}
        priority={1}
        toolCallId="call_123"
        toolName="getWeather"
      />
      <ToolResult
        output={{ temperature: 18, condition: "sunny" }}
        priority={1}
        toolCallId="call_123"
        toolName="getWeather"
      />
    </Message>
  </Region>
);

async function main() {
  // Render to OpenAI Chat Completions format
  const messages = await render(prompt, {
    tokenizer,
    budget: 128_000,
    renderer: chatCompletions,
  });

  console.log("=== Rendered Messages ===");
  console.log(JSON.stringify(messages, null, 2));

  // Use with OpenAI SDK
  const openai = new OpenAI();
  const response = await openai.chat.completions.create({
    model: "gpt-5",
    messages,
  });

  console.log("\n=== AI Response ===");
  console.log(response.choices[0]?.message.content);
}

main().catch(console.error);
