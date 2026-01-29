import { cria } from "@fastpaca/cria";
import { AnthropicProvider } from "@fastpaca/cria/anthropic";
import { OpenAIChatProvider } from "@fastpaca/cria/openai";
import { calcPrice, type PriceCalculationResult } from "@pydantic/genai-prices";
import OpenAI from "openai";

const MODEL = "gpt-5-nano";
const SCOPE_KEY = "tenant:acme";
const TTL_SECONDS = 3600;
const MIN_PROMPT_TOKENS_FOR_CACHE = 1200;
const RUNS = 5;

interface OpenAIChatCompletionResponse {
  choices: Array<{
    message?: { content?: string | null } | null;
  }>;
  usage?: Record<string, unknown>;
}

interface OpenAIChatClientLike {
  chat: {
    completions: {
      create(params: unknown): Promise<OpenAIChatCompletionResponse>;
    };
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const invariant: (condition: unknown, message: string) => asserts condition = (
  condition,
  message
) => {
  if (!condition) {
    throw new Error(message);
  }
};

const requireString = (value: unknown, message: string): string => {
  if (typeof value !== "string") {
    throw new Error(message);
  }
  return value;
};

const requireEnv = (name: string): string =>
  requireString(
    process.env[name],
    `Missing required environment variable: ${name}`
  );

const readStringField = (value: unknown, key: string): string | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }
  const field = value[key];
  return typeof field === "string" ? field : undefined;
};

const readNumberField = (value: unknown, key: string): number | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }
  const field = value[key];
  return typeof field === "number" ? field : undefined;
};

const readRecordField = (
  value: unknown,
  key: string
): Record<string, unknown> | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }
  const field = value[key];
  return isRecord(field) ? field : undefined;
};

const getPromptCacheKey = (request: unknown): string | undefined =>
  readStringField(request, "prompt_cache_key");

const getCacheControl = (block: unknown): unknown =>
  isRecord(block) ? block.cache_control : undefined;

const getUsage = (response: unknown): Record<string, unknown> | undefined =>
  readRecordField(response, "usage");

const getPromptDetails = (
  usage: Record<string, unknown> | undefined
): Record<string, unknown> | undefined =>
  usage ? readRecordField(usage, "prompt_tokens_details") : undefined;

const getCachedTokens = (response: unknown): number => {
  const usage = getUsage(response);
  const promptDetails = getPromptDetails(usage);
  return readNumberField(promptDetails, "cached_tokens") ?? 0;
};

const getPromptTokens = (response: unknown): number => {
  const usage = getUsage(response);
  return readNumberField(usage, "prompt_tokens") ?? 0;
};

const getCompletionTokens = (response: unknown): number => {
  const usage = getUsage(response);
  return readNumberField(usage, "completion_tokens") ?? 0;
};

const getTotalTokens = (response: unknown): number => {
  const usage = getUsage(response);
  const totalTokens = readNumberField(usage, "total_tokens");
  if (typeof totalTokens === "number") {
    return totalTokens;
  }
  return getPromptTokens(response) + getCompletionTokens(response);
};

interface UsageCosts {
  totalCost?: number;
  inputCost?: number;
  outputCost?: number;
}

const getUsageCosts = (response: unknown): UsageCosts => {
  const usage = getUsage(response);
  const totalCost =
    readNumberField(usage, "total_cost") ?? readNumberField(usage, "cost");
  const inputCost =
    readNumberField(usage, "input_cost") ??
    readNumberField(usage, "prompt_cost");
  const outputCost =
    readNumberField(usage, "output_cost") ??
    readNumberField(usage, "completion_cost");

  return {
    ...(typeof totalCost === "number" ? { totalCost } : {}),
    ...(typeof inputCost === "number" ? { inputCost } : {}),
    ...(typeof outputCost === "number" ? { outputCost } : {}),
  };
};

interface UsageStats {
  promptTokens: number;
  cachedTokens: number;
  uncachedPromptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedPercent: number;
  cacheHit: boolean;
  costs: UsageCosts;
}

const percent = (part: number, total: number): number =>
  total > 0 ? Math.round((part / total) * 1000) / 10 : 0;

const buildUsageStats = (response: unknown): UsageStats => {
  const promptTokens = getPromptTokens(response);
  const cachedTokens = getCachedTokens(response);
  const completionTokens = getCompletionTokens(response);
  const totalTokens = getTotalTokens(response);
  const uncachedPromptTokens = Math.max(0, promptTokens - cachedTokens);

  return {
    promptTokens,
    cachedTokens,
    uncachedPromptTokens,
    completionTokens,
    totalTokens,
    cachedPercent: percent(cachedTokens, promptTokens),
    cacheHit: cachedTokens > 0,
    costs: getUsageCosts(response),
  };
};

const formatDelta = (value: number): string =>
  value >= 0 ? `+${value}` : `${value}`;

const formatCost = (value: number): string => `$${value.toFixed(6)}`;

const logUsageStats = (label: string, stats: UsageStats): void => {
  console.log(`  ${label} prompt_tokens: ${stats.promptTokens}`);
  console.log(
    `  ${label} cached_tokens: ${stats.cachedTokens} (${stats.cachedPercent}%)`
  );
  console.log(
    `  ${label} uncached_prompt_tokens: ${stats.uncachedPromptTokens}`
  );
  console.log(`  ${label} completion_tokens: ${stats.completionTokens}`);
  console.log(`  ${label} total_tokens: ${stats.totalTokens}`);
  console.log(`  ${label} cache_hit: ${stats.cacheHit ? "yes" : "no"}`);

  const { totalCost, inputCost, outputCost } = stats.costs;
  if (
    typeof totalCost === "number" ||
    typeof inputCost === "number" ||
    typeof outputCost === "number"
  ) {
    if (typeof totalCost === "number") {
      console.log(`  ${label} cost_total: ${formatCost(totalCost)}`);
    }
    if (typeof inputCost === "number") {
      console.log(`  ${label} cost_input: ${formatCost(inputCost)}`);
    }
    if (typeof outputCost === "number") {
      console.log(`  ${label} cost_output: ${formatCost(outputCost)}`);
    }
  } else {
    console.log(`  ${label} cost: <unavailable>`);
  }
};

const estimatePrice = (stats: UsageStats): PriceCalculationResult => {
  const usage = {
    input_tokens: stats.promptTokens,
    output_tokens: stats.completionTokens,
    ...(stats.cachedTokens > 0
      ? { cache_read_tokens: stats.cachedTokens }
      : {}),
  };

  return calcPrice(usage, MODEL, { providerId: "openai" });
};

const logEstimatedPrice = (
  label: string,
  price: PriceCalculationResult
): void => {
  if (!price) {
    console.log(`  ${label} price_estimate: <unavailable>`);
    return;
  }

  console.log(
    `  ${label} price_estimate: ${formatCost(price.total_price)} (input: ${formatCost(price.input_price)}, output: ${formatCost(price.output_price)})`
  );
};

const sumUsageStats = (statsList: UsageStats[]): UsageStats => {
  const totals = statsList.reduce(
    (acc, stats) => ({
      promptTokens: acc.promptTokens + stats.promptTokens,
      cachedTokens: acc.cachedTokens + stats.cachedTokens,
      uncachedPromptTokens:
        acc.uncachedPromptTokens + stats.uncachedPromptTokens,
      completionTokens: acc.completionTokens + stats.completionTokens,
      totalTokens: acc.totalTokens + stats.totalTokens,
    }),
    {
      promptTokens: 0,
      cachedTokens: 0,
      uncachedPromptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    }
  );

  return {
    ...totals,
    cachedPercent: percent(totals.cachedTokens, totals.promptTokens),
    cacheHit: totals.cachedTokens > 0,
    costs: {},
  };
};

const sumPrices = (
  prices: PriceCalculationResult[]
): { total?: number; input?: number; output?: number } => {
  let total = 0;
  let input = 0;
  let output = 0;
  let available = true;

  for (const price of prices) {
    if (!price) {
      available = false;
      continue;
    }
    total += price.total_price;
    input += price.input_price;
    output += price.output_price;
  }

  if (!available) {
    return {};
  }

  return { total, input, output };
};

const logPriceSavings = (options: {
  unpinned: { total?: number; input?: number; output?: number };
  pinned: { total?: number; input?: number; output?: number };
}): void => {
  const { unpinned, pinned } = options;
  if (typeof pinned.total !== "number" || typeof unpinned.total !== "number") {
    return;
  }

  const totalSavings = unpinned.total - pinned.total;
  const totalSavingsPercent = percent(totalSavings, unpinned.total);

  console.log(
    `  price_estimate savings (total): ${formatCost(totalSavings)} (${totalSavingsPercent}%)`
  );

  if (typeof pinned.input === "number" && typeof unpinned.input === "number") {
    const inputSavings = unpinned.input - pinned.input;
    const inputSavingsPercent = percent(inputSavings, unpinned.input);

    console.log(
      `  price_estimate savings (input): ${formatCost(inputSavings)} (${inputSavingsPercent}%)`
    );
  }

  if (
    typeof pinned.output === "number" &&
    typeof unpinned.output === "number"
  ) {
    const outputDelta = pinned.output - unpinned.output;
    console.log(`  price_estimate Δ (output): ${formatCost(outputDelta)}`);
  }
};

const isEphemeralOneHourCacheControl = (value: unknown): boolean =>
  isRecord(value) && value.type === "ephemeral" && value.ttl === "1h";

const makeLargeSystemInstructions = (
  repeatCount: number,
  label: string
): string => {
  const baseRule =
    "Follow the Cria system rules exactly. Be concise, explicit, and safe.";
  const rules = Array.from(
    { length: repeatCount },
    (_unused, index) => `Rule ${label}-${index + 1}: ${baseRule}`
  );
  return rules.join("\n");
};

const countPromptTokens = async (
  provider: OpenAIChatProvider,
  systemText: string
): Promise<number> => {
  const rendered = await cria
    .prompt(provider)
    .system(systemText)
    .user("ping")
    .render();
  return provider.countTokens(rendered);
};

const buildLargeSystemText = async (
  provider: OpenAIChatProvider,
  targetTokens: number
): Promise<{ systemText: string; approxTokens: number }> => {
  let repeatCount = 128;
  let systemText = makeLargeSystemInstructions(repeatCount, "ab");
  let approxTokens = await countPromptTokens(provider, systemText);

  while (approxTokens < targetTokens) {
    repeatCount *= 2;
    systemText = makeLargeSystemInstructions(repeatCount, "ab");
    approxTokens = await countPromptTokens(provider, systemText);
  }

  return { systemText, approxTokens };
};

const createUnpinnedSystem = (
  systemText: string,
  label: string
): ReturnType<typeof cria.prompt> =>
  cria.prompt().system(`Unpinned nonce: ${label}\n\n${systemText}`);

type OpenAIRequest = Record<string, unknown>;

const createOpenAiClient = (
  baseClient: OpenAI
): {
  client: OpenAIChatClientLike;
  requests: OpenAIRequest[];
  responses: OpenAIChatCompletionResponse[];
} => {
  const requests: OpenAIRequest[] = [];
  const responses: OpenAIChatCompletionResponse[] = [];

  const client: OpenAIChatClientLike = {
    chat: {
      completions: {
        create: async (params: unknown) => {
          requests.push(params as OpenAIRequest);
          const response = await baseClient.chat.completions.create(
            params as never
          );
          responses.push(response as OpenAIChatCompletionResponse);
          return response as OpenAIChatCompletionResponse;
        },
      },
    },
  };

  return { client, requests, responses };
};

const createRenderWithSystem =
  (provider: OpenAIChatProvider, requests: unknown[], responses: unknown[]) =>
  async (
    systemPrompt: ReturnType<typeof cria.prompt>,
    userText: string
  ): Promise<{ key?: string; response?: unknown }> => {
    const rendered = await cria
      .prompt(provider)
      .prefix(systemPrompt)
      .user(userText)
      .render();

    await provider.completion(rendered);

    const lastRequest = requests.at(-1);
    const lastResponse = responses.at(-1);
    return {
      key: getPromptCacheKey(lastRequest),
      response: lastResponse,
    };
  };

const runPinnedUnpinnedSeries = async (options: {
  runs: number;
  baseSystem: ReturnType<typeof cria.prompt>;
  systemText: string;
  renderWithSystem: (
    systemPrompt: ReturnType<typeof cria.prompt>,
    userText: string
  ) => Promise<{ key?: string; response?: unknown }>;
}): Promise<{
  unpinnedStatsList: UsageStats[];
  pinnedStatsList: UsageStats[];
  unpinnedPrices: PriceCalculationResult[];
  pinnedPrices: PriceCalculationResult[];
  pinnedKey: string;
}> => {
  const unpinnedStatsList: UsageStats[] = [];
  const pinnedStatsList: UsageStats[] = [];
  const unpinnedPrices: PriceCalculationResult[] = [];
  const pinnedPrices: PriceCalculationResult[] = [];

  // Pin the shared prefix once; continue chaining for the unpinned tail.
  const pinnedSystem = options.baseSystem.pin({
    id: "system:v1",
    scopeKey: SCOPE_KEY,
    ttlSeconds: TTL_SECONDS,
  });

  let pinnedKey: string | undefined;

  for (let index = 0; index < options.runs; index += 1) {
    const runLabel = `run-${index + 1}`;

    const unpinnedRun = await options.renderWithSystem(
      createUnpinnedSystem(options.systemText, runLabel),
      `Unpinned hello ${index + 1}`
    );
    invariant(
      unpinnedRun.key === undefined,
      "Expected no prompt_cache_key without pinning."
    );

    const unpinnedStats = buildUsageStats(unpinnedRun.response);
    unpinnedStatsList.push(unpinnedStats);
    unpinnedPrices.push(estimatePrice(unpinnedStats));

    const pinnedRun = await options.renderWithSystem(
      pinnedSystem,
      `Pinned hello ${index + 1}`
    );
    const runKey = requireString(
      pinnedRun.key,
      "Expected prompt_cache_key to be set for pinned prefix."
    );

    if (pinnedKey) {
      invariant(
        runKey === pinnedKey,
        "Expected prompt_cache_key to stay stable when only the tail changes."
      );
    } else {
      pinnedKey = runKey;
    }

    const pinnedStats = buildUsageStats(pinnedRun.response);
    pinnedStatsList.push(pinnedStats);
    pinnedPrices.push(estimatePrice(pinnedStats));
  }

  const stablePinnedKey = requireString(
    pinnedKey,
    "Expected a stable prompt_cache_key for pinned runs."
  );

  return {
    unpinnedStatsList,
    pinnedStatsList,
    unpinnedPrices,
    pinnedPrices,
    pinnedKey: stablePinnedKey,
  };
};

const validatePinnedPrefixChange = async (options: {
  renderWithSystem: (
    systemPrompt: ReturnType<typeof cria.prompt>,
    userText: string
  ) => Promise<{ key?: string; response?: unknown }>;
  pinnedKey: string;
}): Promise<string> => {
  const pinnedSystemV2 = cria
    .prompt()
    .system("Static instructions v2")
    .pin({ id: "system:v1", scopeKey: SCOPE_KEY, ttlSeconds: TTL_SECONDS });

  const pinnedRun = await options.renderWithSystem(
    pinnedSystemV2,
    "Pinned hello 3"
  );
  const changedKey = requireString(
    pinnedRun.key,
    "Expected prompt_cache_key to be set for pinned prefix."
  );
  invariant(
    options.pinnedKey !== changedKey,
    "Expected prompt_cache_key to change when the pinned prefix changes."
  );

  return changedKey;
};

async function runOpenAiAbTest(): Promise<void> {
  const apiKey = requireEnv("OPENAI_API_KEY");
  const baseClient = new OpenAI({ apiKey });
  const { client, requests, responses } = createOpenAiClient(baseClient);
  const provider = new OpenAIChatProvider(client, MODEL);
  const { systemText, approxTokens } = await buildLargeSystemText(
    provider,
    MIN_PROMPT_TOKENS_FOR_CACHE
  );

  const baseSystem = cria.prompt().system(systemText);
  const renderWithSystem = createRenderWithSystem(
    provider,
    requests,
    responses
  );

  const series = await runPinnedUnpinnedSeries({
    runs: RUNS,
    baseSystem,
    systemText,
    renderWithSystem,
  });

  const changedPrefixKey = await validatePinnedPrefixChange({
    renderWithSystem,
    pinnedKey: series.pinnedKey,
  });

  const sampleIndex = Math.min(1, RUNS - 1);
  const unpinnedStats = series.unpinnedStatsList[sampleIndex];
  const pinnedStats = series.pinnedStatsList[sampleIndex];
  const unpinnedPrice = series.unpinnedPrices[sampleIndex];
  const pinnedPrice = series.pinnedPrices[sampleIndex];

  const unpinnedTotals = sumUsageStats(series.unpinnedStatsList);
  const pinnedTotals = sumUsageStats(series.pinnedStatsList);
  const unpinnedPriceTotals = sumPrices(series.unpinnedPrices);
  const pinnedPriceTotals = sumPrices(series.pinnedPrices);

  console.log("OpenAI A/B (unpinned vs pinned) verified.");
  console.log(`Model: ${MODEL}`);
  console.log(`Approx prompt tokens (target): ${approxTokens}`);
  console.log("Unpinned uses a per-run nonce to prevent cache reuse.");
  console.log("Unpinned key: <none>");
  console.log(`Pinned key (stable): ${series.pinnedKey}`);
  console.log(`Pinned key (changed prefix): ${changedPrefixKey}`);
  console.log("\nOpenAI usage (sample run #2):");
  logUsageStats("unpinned", unpinnedStats);
  logEstimatedPrice("unpinned", unpinnedPrice);
  logUsageStats("pinned", pinnedStats);
  logEstimatedPrice("pinned", pinnedPrice);

  console.log(`\nCumulative totals (${RUNS} runs):`);
  logUsageStats("unpinned", unpinnedTotals);
  logUsageStats("pinned", pinnedTotals);

  console.log("\nCache impact (pinned - unpinned, totals):");
  console.log(
    `  cached_tokens Δ: ${formatDelta(
      pinnedTotals.cachedTokens - unpinnedTotals.cachedTokens
    )}`
  );
  console.log(
    `  uncached_prompt_tokens Δ: ${formatDelta(
      pinnedTotals.uncachedPromptTokens - unpinnedTotals.uncachedPromptTokens
    )}`
  );
  console.log(
    `  total_tokens Δ: ${formatDelta(
      pinnedTotals.totalTokens - unpinnedTotals.totalTokens
    )}`
  );

  logPriceSavings({
    unpinned: unpinnedPriceTotals,
    pinned: pinnedPriceTotals,
  });
}

async function verifyAnthropicCacheControl(): Promise<void> {
  const client = {
    messages: {
      create: (_params: unknown) =>
        Promise.resolve({ content: [{ type: "text", text: "ok" }] }),
    },
  };

  const provider = new AnthropicProvider(
    client as never,
    "claude-3-5-sonnet-latest" as never,
    256
  );

  const pinnedSystem = cria
    .prompt()
    .system("Pinned rules")
    .pin({ id: "rules:v1", ttlSeconds: TTL_SECONDS });

  const renderedPinned = await cria
    .prompt(provider)
    .prefix(pinnedSystem)
    .user("Hi")
    .render();

  const systemPinned = renderedPinned.system;
  invariant(
    Array.isArray(systemPinned),
    "Expected pinned Anthropic system content to render as blocks."
  );
  if (!Array.isArray(systemPinned)) {
    throw new Error("Pinned system was not rendered as blocks.");
  }

  const firstBlock = systemPinned[0];
  const cacheControl = getCacheControl(firstBlock);
  invariant(
    isEphemeralOneHourCacheControl(cacheControl),
    'Expected Anthropic cache_control to be { type: "ephemeral", ttl: "1h" }.'
  );

  console.log("\nAnthropic cache_control verified.");
  console.log("Pinned system cache_control:", cacheControl);
}

async function main(): Promise<void> {
  console.log("== Provider Cache Pinning A/B Test (Real API) ==\n");
  await runOpenAiAbTest();
  console.log("");
  await verifyAnthropicCacheControl();
  console.log("\nAll cache pinning checks passed.");
}

main().catch((error: unknown) => {
  console.error("Cache pinning verification failed.");
  console.error(error);
  process.exitCode = 1;
});
