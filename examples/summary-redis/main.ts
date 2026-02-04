/**
 * Summary with Redis - progressive summarization with persistent cache
 *
 * Requires: Redis running locally (docker run -p 6379:6379 redis)
 */

import { cria, type StoredSummary, Summary } from "@fastpaca/cria";
import { RedisStore } from "@fastpaca/cria/memory/redis";
import { createProvider } from "@fastpaca/cria/openai";
import OpenAI from "openai";

const client = new OpenAI();
const provider = createProvider(client, "gpt-4o-mini");

const store = new RedisStore<StoredSummary>({ keyPrefix: "cria:summary:" });

const history = cria
  .prompt()
  .user("I'm planning a trip to Berlin.")
  .assistant("Great choice! Berlin has rich history and culture.")
  .user("What neighborhoods should I stay in?")
  .assistant("Prenzlauer Berg and Kreuzberg are popular.")
  .user("What are the must-see historical sites?")
  .assistant("Brandenburg Gate, Berlin Wall Memorial, Museum Island.");

const summary = new Summary({
  id: "travel-chat",
  store,
  priority: 2,
  provider,
}).extend(history);

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

await store.disconnect();
