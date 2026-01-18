/**
 * Example: RAG (Retrieval Augmented Generation) with Cria + ChromaDB
 *
 * This example demonstrates how easy it is to add vector search to your prompts.
 * The VectorSearch component automatically retrieves relevant context at render time,
 * making your AI responses more accurate and grounded in your knowledge base.
 *
 * Prerequisites:
 *   1. Run ChromaDB: docker run -p 8000:8000 chromadb/chroma
 *   2. Set OPENAI_API_KEY environment variable
 *
 * Run with: pnpm start
 */

import { cria } from "@fastpaca/cria";
import { ChromaStore } from "@fastpaca/cria/memory/chroma";
import { createProvider } from "@fastpaca/cria/openai";
import { ChromaClient } from "chromadb";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const provider = createProvider(openai, "gpt-4o-mini");

// ============================================================================
// Step 1: Connect to ChromaDB and create a collection
// ============================================================================

const chroma = new ChromaClient({ path: "http://localhost:8000" });
const collection = await chroma.getOrCreateCollection({
  name: "fastpaca-docs",
});

// ============================================================================
// Step 2: Create a ChromaStore with your embedding function
// ============================================================================

const knowledgeBase = new ChromaStore<string>({
  collection,
  embed: async (text) => {
    const response = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: text,
    });
    return response.data[0].embedding;
  },
});

// ============================================================================
// Step 3: Populate your knowledge base
// ============================================================================

// Imagine these are documents from your database, PDFs, or any data source
const documents = [
  {
    id: "pricing-basic",
    content:
      "FastPaca Basic Plan: $9/month. Includes 1,000 API calls per month, email support, and access to core features. Perfect for individuals and small projects.",
  },
  {
    id: "pricing-pro",
    content:
      "FastPaca Pro Plan: $49/month. Includes 50,000 API calls per month, priority support with 4-hour response time, advanced analytics, team collaboration (up to 5 users), and custom integrations.",
  },
  {
    id: "pricing-enterprise",
    content:
      "FastPaca Enterprise Plan: Custom pricing. Unlimited API calls, dedicated support engineer, SLA guarantees (99.9% uptime), SSO/SAML, audit logs, and on-premise deployment options. Contact sales@fastpaca.com for a quote.",
  },
  {
    id: "feature-api",
    content:
      "FastPaca API: RESTful API with SDKs for JavaScript, Python, and Go. Supports batch processing, webhooks for real-time updates, and rate limiting based on your plan. Authentication via API keys or OAuth 2.0.",
  },
  {
    id: "feature-analytics",
    content:
      "FastPaca Analytics Dashboard: Real-time usage metrics, cost tracking, and performance insights. Export data to CSV or connect to your BI tools via our data export API. Available on Pro and Enterprise plans.",
  },
  {
    id: "security",
    content:
      "FastPaca Security: SOC 2 Type II certified. All data encrypted at rest (AES-256) and in transit (TLS 1.3). GDPR compliant with data residency options in US, EU, and APAC. Automatic backups with 30-day retention.",
  },
  {
    id: "getting-started",
    content:
      "Getting Started with FastPaca: 1) Sign up at app.fastpaca.com 2) Generate an API key in Settings 3) Install our SDK: npm install @fastpaca/sdk 4) Make your first API call. Our quickstart guide takes under 5 minutes.",
  },
  {
    id: "support",
    content:
      "FastPaca Support: Community support via Discord for all plans. Email support (support@fastpaca.com) for Basic+ plans with 24-hour response time. Priority support with 4-hour response for Pro plans. Dedicated Slack channel and named engineer for Enterprise.",
  },
];

console.log("📚 Loading knowledge base into ChromaDB...");
await Promise.all(
  documents.map((doc) => knowledgeBase.set(doc.id, doc.content))
);
console.log(`✅ Loaded ${documents.length} documents\n`);

// ============================================================================
// Step 4: Build your prompt with VectorSearch - that's it!
// ============================================================================

// The user's question
const userQuestion =
  "What's included in the Pro plan and how do I get started?";

// Build the prompt - VectorSearch automatically retrieves relevant context
const prompt = cria
  .prompt()
  .message(
    "system",
    [
      "You are a helpful customer support agent for FastPaca.",
      "Answer questions based on the knowledge base context provided.",
      "Be concise and helpful. If information isn't in the context, say you don't know.",
      "## Relevant Knowledge Base Articles\n",
    ].join(" "),
    { priority: 0 }
  )
  .user((m) =>
    m
      .vectorSearch({
        limit: 3,
        store: knowledgeBase,
        query: userQuestion,
        priority: 0,
      })
      .append("\n\n")
      .append(userQuestion)
  );

// ============================================================================
// Step 5: Render and use with OpenAI
// ============================================================================

console.log("🔍 User Question:", userQuestion);
console.log("\n⏳ Searching knowledge base and rendering prompt...\n");

const messages = await prompt.render({
  provider,
  budget: 128_000,
});

console.log("=== Rendered Messages ===");
console.log(JSON.stringify(messages, null, 2));
console.log(`=== Token count: ${provider.countTokens(messages)} / 128000 ===`);

// Make the actual API call
console.log("\n🤖 Calling OpenAI...\n");

const response = await openai.chat.completions.create({
  model: "gpt-4o-mini",
  messages,
});

console.log("=== AI Response ===");
console.log(response.choices[0]?.message.content);

// ============================================================================
// Bonus: Try different questions to see semantic search in action
// ============================================================================

console.log(`\n${"=".repeat(60)}`);
console.log("💡 Try changing userQuestion to test semantic search:");
console.log('   - "How much does it cost?"');
console.log('   - "Is my data secure?"');
console.log('   - "How do I contact support?"');
console.log('   - "What programming languages do you support?"');
console.log("=".repeat(60));
