/**
 * DevTools Smoke - send a single render trace to the DevTools server.
 */

import { cria } from "@fastpaca/cria";
import { createProvider } from "@fastpaca/cria/openai";
import OpenAI from "openai";

// Enable devtools tracing globally
cria.devtools({ serviceName: "cria-examples" });

const provider = createProvider(new OpenAI({ apiKey: "test" }), "gpt-4o-mini");

try {
  const { messages } = await cria
    .prompt(provider)
    .system("You are helpful.")
    .user("Send a DevTools trace.")
    .assistant("Trace sent.")
    .render({ budget: 800 });

  console.log(`Rendered ${messages.length} messages.`);
  console.log("Trace sent to DevTools.");
} finally {
  await cria.devtools.shutdown();
}
