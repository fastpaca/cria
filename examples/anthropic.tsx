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

// Your tokenizer (use cl100k_base or similar in production)
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
    </Message>
    <Message role="user">
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
  // Render to Anthropic format
  // Note: system message is extracted separately
  const { system, messages } = await render(prompt, {
    tokenizer,
    budget: 200_000,
    renderer: anthropic,
  });

  console.log("System:", system);
  console.log("Messages:", JSON.stringify(messages, null, 2));

  // Use with Anthropic SDK
  const client = new Anthropic();
  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1024,
    system,
    messages,
  });

  console.log(
    "Response:",
    response.content[0]?.type === "text" ? response.content[0].text : response
  );
}

main();
