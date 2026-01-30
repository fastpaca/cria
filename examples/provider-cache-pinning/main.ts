import { cria } from "@fastpaca/cria";
import { OpenAIChatProvider } from "@fastpaca/cria/openai";
import OpenAI from "openai";
import type { ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions";

const MODEL = "gpt-5-nano";
const SCOPE_KEY = "tenant:acme";
const TTL_SECONDS = 3600;
const SYSTEM_REPEAT = 256;

type OpenAIRequest = ChatCompletionCreateParamsNonStreaming & {
  prompt_cache_key?: string;
};

const requireEnv = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
};

const buildSystemText = (): string => {
  const baseRule =
    "Follow the Cria system rules exactly. Be concise, explicit, and safe.";
  const rules = Array.from(
    { length: SYSTEM_REPEAT },
    (_unused, index) => `Rule ${index + 1}: ${baseRule}`
  );
  return rules.join("\n");
};

const main = async (): Promise<void> => {
  const apiKey = requireEnv("OPENAI_API_KEY");
  const baseClient = new OpenAI({ apiKey });

  let lastRequest: OpenAIRequest | undefined;

  const client = {
    chat: {
      completions: {
        create: async (params: OpenAIRequest) => {
          lastRequest = params;
          return await baseClient.chat.completions.create(params);
        },
      },
    },
  };

  const provider = new OpenAIChatProvider(client, MODEL);
  const systemText = buildSystemText();

  // Pin the stable prefix once; reuse it across requests.
  const pinnedPrefix = cria
    .prompt()
    .system(systemText)
    .pin({ id: "system:v1", scopeKey: SCOPE_KEY, ttlSeconds: TTL_SECONDS });

  const renderAndComplete = async (
    systemPrompt: ReturnType<typeof cria.prompt>,
    userText: string
  ): Promise<OpenAIRequest> => {
    const rendered = await cria
      .prompt(provider)
      .prefix(systemPrompt)
      .user(userText)
      .render();

    await provider.completion(rendered);

    if (!lastRequest) {
      throw new Error("Expected OpenAI request to be captured.");
    }

    return lastRequest;
  };

  const firstPinned = await renderAndComplete(pinnedPrefix, "Hello 1");
  const secondPinned = await renderAndComplete(pinnedPrefix, "Hello 2");

  const pinnedKey = firstPinned.prompt_cache_key;
  if (!pinnedKey || secondPinned.prompt_cache_key !== pinnedKey) {
    throw new Error(
      "Expected a stable prompt_cache_key for the pinned prefix."
    );
  }

  const unpinned = await renderAndComplete(
    cria.prompt().system(systemText),
    "Hello 3"
  );
  if (unpinned.prompt_cache_key) {
    throw new Error("Expected no prompt_cache_key without pinning.");
  }

  const pinnedPrefixV2 = cria
    .prompt()
    .system(`${systemText}\nRule v2: Keep responses tight.`)
    .pin({ id: "system:v2", scopeKey: SCOPE_KEY, ttlSeconds: TTL_SECONDS });

  const changedPinned = await renderAndComplete(pinnedPrefixV2, "Hello 4");
  if (changedPinned.prompt_cache_key === pinnedKey) {
    throw new Error(
      "Expected prompt_cache_key to change when the pinned prefix changes."
    );
  }
};

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
