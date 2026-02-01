/**
 * Conversation - truncate history from the start when over budget
 */

import { cria } from "@fastpaca/cria";
import { createProvider } from "@fastpaca/cria/openai";
import OpenAI from "openai";

const client = new OpenAI();
const provider = createProvider(client, "gpt-4o-mini");

const history = cria
  .prompt()
  .user("What's the capital of Germany?")
  .assistant("Berlin is the capital of Germany.")
  .user("How many people live there?")
  .assistant("Berlin has approximately 3.7 million residents.")
  .user("What's it famous for?")
  .assistant("The Brandenburg Gate, Berlin Wall, and vibrant nightlife.");

const prompt = cria
  .prompt(provider)
  .system("You are a helpful assistant.")
  .truncate(history, { budget: 30, from: "start", priority: 2 })
  .user("Tell me one more interesting fact.");

const result = await prompt.render({ budget: 50 });

console.log("=== Rendered (older messages truncated) ===");
console.log(`Token count: ${provider.countTokens(result)}`);
console.log(JSON.stringify(result.messages, null, 2));

const response = await client.chat.completions.create({
  model: "gpt-4o-mini",
  messages: result.messages,
});

console.log("\n=== Response ===");
console.log(response.choices[0]?.message?.content);
