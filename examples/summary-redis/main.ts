/**
 * Summary with Redis - progressive summarization with persistent cache
 *
 * Requires: Redis running locally (docker run -p 6379:6379 redis)
 */

import { cria } from "@fastpaca/cria";
import { createProvider } from "@fastpaca/cria/openai";
import OpenAI from "openai";

const client = new OpenAI();
const provider = createProvider(client, "gpt-4o-mini");

const summarizer = cria.summarizer({
  id: "travel-chat",
  store: { redis: { keyPrefix: "cria:summary:" } },
  priority: 2,
  provider,
});

const history = cria
  .prompt()
  .user("I'm planning a trip to Berlin.")
  .assistant("Great choice! Berlin has rich history and culture.")
  .user("What neighborhoods should I stay in?")
  .assistant("Prenzlauer Berg and Kreuzberg are popular.")
  .user("What are the must-see historical sites?")
  .assistant("Brandenburg Gate, Berlin Wall Memorial, Museum Island.");

const summary = summarizer({ history });

const prompt = cria
  .prompt(provider)
  .system("You are a helpful travel assistant.")
  .use(summary)
  .user("What's a good 1-day itinerary?");

const { messages } = await prompt.render({ budget: 300 });
console.log("=== Messages ===");
console.log(JSON.stringify(messages, null, 2));

const response = await client.chat.completions.create({
  model: "gpt-4o-mini",
  messages,
});

console.log("\n=== Response ===");
console.log(response.choices[0]?.message?.content);
