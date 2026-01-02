/**
 * Example: Using Cria with OpenAI Responses API (o1/o3 models)
 *
 * This example shows how to build a prompt with native reasoning support
 * and render it to ResponseInputItem[] for use with the OpenAI Responses API.
 */

import { Message, Reasoning, Region, render } from "@fastpaca/cria";
import { responses } from "@fastpaca/cria/openai";
import OpenAI from "openai";

// Your tokenizer (use tiktoken or similar in production)
const tokenizer = (text: string) => Math.ceil(text.length / 4);

// Build your prompt with Cria components
// The Reasoning component renders as native reasoning blocks for o1/o3
const prompt = (
  <Region priority={0}>
    <Message role="system">
      You are a mathematical reasoning assistant. Think step by step.
    </Message>
    <Message role="user">
      What is the sum of all prime numbers less than 20?
    </Message>
    <Reasoning
      priority={1}
      text="Let me identify all primes less than 20: 2, 3, 5, 7, 11, 13, 17, 19. Now I'll sum them: 2+3+5+7+11+13+17+19 = 77"
    />
    <Message role="assistant">
      The sum of all prime numbers less than 20 is 77.
    </Message>
  </Region>
);

async function main() {
  // Render to OpenAI Responses format
  const input = await render(prompt, {
    tokenizer,
    budget: 128_000,
    renderer: responses,
  });

  console.log("Rendered input:", JSON.stringify(input, null, 2));

  // Use with OpenAI SDK (Responses API)
  const openai = new OpenAI();
  const response = await openai.responses.create({
    model: "o3",
    input,
  });

  console.log("Response:", response.output_text);
}

main();
