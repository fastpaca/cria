/**
 * Priorities - show how omit/truncate work with tight budgets
 */

import { cria } from "@fastpaca/cria";
import { createProvider } from "@fastpaca/cria/openai";
import OpenAI from "openai";

const client = new OpenAI();
const provider = createProvider(client, "gpt-4o-mini");

const context = `Berlin is Germany's capital with ~3.7 million people.
It was divided during the Cold War and reunified in 1990.
Key landmarks: Brandenburg Gate, Berlin Wall Memorial, Museum Island.`;

const prompt = cria
  .prompt(provider)
  .system("You are a helpful assistant.")
  .omit(cria.prompt().assistant(`Context:\n${context}`), { priority: 3 })
  .user("What are Berlin's main landmarks?");

// Tight budget - context gets dropped
const tight = await prompt.render({ budget: 30 });
console.log("=== Tight budget (30 tokens) ===");
console.log(`Token count: ${provider.countTokens(tight)}`);
console.log(JSON.stringify(tight.messages, null, 2));

// Generous budget - context is included
const generous = await prompt.render({ budget: 500 });
console.log("\n=== Generous budget (500 tokens) ===");
console.log(`Token count: ${provider.countTokens(generous)}`);
console.log(JSON.stringify(generous.messages, null, 2));
