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

// Your tokenizer (use tiktoken or similar in production)
const tokenizer = (text: string) => Math.ceil(text.length / 4);

// Build your prompt with Cria components
const prompt = (
  <Region priority={0}>
    <Message role="system">
      You are a mathematical reasoning assistant. Think step by step.
    </Message>
    <Message role="user">
      What is the sum of all prime numbers less than 20?
    </Message>
  </Region>
);

// Example with tool calls (showing full Responses API capabilities)
const toolPrompt = (
  <Region priority={0}>
    <Message role="system">You are a helpful weather assistant.</Message>
    <Message role="user">What's the weather in Paris?</Message>
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
    <Message role="assistant">
      The weather in Paris is sunny with a temperature of 18°C.
    </Message>
  </Region>
);

async function main() {
  // Render simple prompt to OpenAI Responses format
  const input = await render(prompt, {
    tokenizer,
    budget: 128_000,
    renderer: responses,
  });

  console.log("Rendered input:", JSON.stringify(input, null, 2));

  // Render tool prompt to show function_call/function_call_output items
  const toolInput = await render(toolPrompt, {
    tokenizer,
    budget: 128_000,
    renderer: responses,
  });

  console.log("\nRendered tool input:", JSON.stringify(toolInput, null, 2));

  // Use with OpenAI SDK (Responses API)
  const openai = new OpenAI();
  const response = await openai.responses.create({
    model: "gpt-5",
    input,
  });

  console.log("\nResponse:", response.output_text);
}

main();
