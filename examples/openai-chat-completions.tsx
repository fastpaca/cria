/**
 * Example: Using Cria with OpenAI Chat Completions API
 *
 * This example shows how to build a prompt with Cria and render it
 * to ChatCompletionMessageParam[] for use with the OpenAI SDK.
 */

import { Message, Region, render, ToolCall, ToolResult } from "@fastpaca/cria";
import { chatCompletions } from "@fastpaca/cria/openai";
import OpenAI from "openai";

// Your tokenizer (use tiktoken or similar in production)
const tokenizer = (text: string) => Math.ceil(text.length / 4);

// Build your prompt with Cria components
const prompt = (
  <Region priority={0}>
    <Message role="system">You are a helpful weather assistant.</Message>
    <Message role="user">What's the weather in Paris?</Message>
    <Message role="assistant">
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
    <Message role="assistant">
      The weather in Paris is sunny with a temperature of 18°C.
    </Message>
  </Region>
);

async function main() {
  // Render to OpenAI format
  const messages = await render(prompt, {
    tokenizer,
    budget: 128_000,
    renderer: chatCompletions,
  });

  console.log("Rendered messages:", JSON.stringify(messages, null, 2));

  // Use with OpenAI SDK
  const openai = new OpenAI();
  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages,
  });

  console.log("Response:", response.choices[0]?.message.content);
}

main();
