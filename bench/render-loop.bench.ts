import {
  cria,
  FitError,
  InMemoryStore,
  type PromptNode,
  type PromptPart,
  type PromptTree,
  type RenderHooks,
  render,
  type StoredSummary,
  type SummarizerContext,
} from "@fastpaca/cria";
import { bench, describe } from "vitest";
import { createTestProvider } from "../src/testing/plaintext";

const provider = createTestProvider({
  joinMessagesWith: "\n\n",
  includeRolePrefix: true,
});

const ROLE_SEPARATOR = ": ";
const WHITESPACE_RE = /\s+/g;

const systemPrompt =
  "You are Cria, a rendering engine that must follow instructions exactly while staying within a strict token budget.";
const developerPrompt =
  "Prefer correctness over creativity. When trimming context, keep the most recent and most actionable details.";
const latestUserPrompt =
  "Given the conversation and retrieved context, propose the next best tool call and a concise assistant message.";

interface BodyBase {
  historyUser: string;
  historyAssistant: string;
  example: string;
  optional: string;
}

const DEFAULT_BODY_BASE: BodyBase = {
  historyUser: "The user describes steps, constraints, and notes. ",
  historyAssistant:
    "The assistant reflects context, proposes a plan, and adds rationale. ",
  example: "Helpful example content that can be trimmed. ",
  optional: "Low-priority context that should drop early. ",
};

function buildHistoryMessages(
  count: number,
  userBody: string,
  assistantBody: string
): readonly PromptNode[] {
  return Array.from({ length: count }, (_, index) => {
    const turn = index + 1;
    if (turn % 2 === 1) {
      return cria.user(`User turn ${turn}. ${userBody}`);
    }
    return cria.assistant(`Assistant turn ${turn}. ${assistantBody}`);
  });
}

function buildExampleMessages(
  count: number,
  body: string
): readonly PromptNode[] {
  return Array.from({ length: count }, (_, index) =>
    cria.user(`Example ${index + 1}: ${body}`)
  );
}

function buildOptionalMessages(
  count: number,
  body: string
): readonly PromptNode[] {
  return Array.from({ length: count }, (_, index) =>
    cria.user(`Optional context ${index + 1}: ${body}`)
  );
}

function renderPart(part: PromptPart): string {
  if (part.type === "text" || part.type === "reasoning") {
    return part.text;
  }
  if (part.type === "tool-call") {
    return `[tool-call:${part.toolName}]${String(part.input)}`;
  }
  return `[tool-result:${part.toolName}]${String(part.output)}`;
}

function renderMessage(node: Extract<PromptNode, { kind: "message" }>): string {
  let content = "";
  for (const part of node.children) {
    content += renderPart(part);
  }
  return `${node.role}${ROLE_SEPARATOR}${content}`;
}

function collectMessages(node: PromptNode): string[] {
  if (node.kind === "message") {
    return [renderMessage(node)];
  }

  const lines: string[] = [];
  for (const child of node.children) {
    const childLines = collectMessages(child);
    for (const childLine of childLines) {
      lines.push(childLine);
    }
  }
  return lines;
}

function compact(text: string): string {
  return text.replace(WHITESPACE_RE, " ").trim();
}

function clampSummary(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, maxChars)}...`;
}

interface FitExpectation {
  minIterations: number;
  requiredPriorities: readonly number[];
  requireFitLoop?: boolean;
}

interface FitMetrics {
  fitStarted: boolean;
  iterations: number;
  priorities: Map<number, number>;
  startTokens: number | null;
  endTokens: number | null;
}

function createFitMetrics(): {
  metrics: FitMetrics;
  hooks: RenderHooks;
} {
  const metrics: FitMetrics = {
    fitStarted: false,
    iterations: 0,
    priorities: new Map<number, number>(),
    startTokens: null,
    endTokens: null,
  };

  const hooks: RenderHooks = {
    onFitStart(event) {
      metrics.fitStarted = true;
      metrics.startTokens = event.totalTokens;
    },
    onFitIteration() {
      metrics.iterations += 1;
    },
    onStrategyApplied(event) {
      const current = metrics.priorities.get(event.priority) ?? 0;
      metrics.priorities.set(event.priority, current + 1);
    },
    onFitComplete(event) {
      metrics.endTokens = event.totalTokens;
    },
    onFitError(event) {
      throw event.error;
    },
  };

  return { metrics, hooks };
}

function assertExpectation(params: {
  name: string;
  baselineTokens: number;
  budget: number;
  tokens: number;
  metrics: FitMetrics;
  expectation: FitExpectation;
}): void {
  const { name, baselineTokens, budget, tokens, metrics, expectation } = params;
  const requireFitLoop = expectation.requireFitLoop ?? true;
  const fitNeeded = baselineTokens > budget;

  if (fitNeeded && requireFitLoop && !metrics.fitStarted) {
    throw new Error(`${name}: expected fit loop to start.`);
  }

  if (
    fitNeeded &&
    requireFitLoop &&
    metrics.iterations < expectation.minIterations
  ) {
    throw new Error(
      `${name}: expected at least ${expectation.minIterations} fit iterations, got ${metrics.iterations}.`
    );
  }

  if (tokens > budget) {
    throw new Error(`${name}: render exceeded budget (${tokens} > ${budget}).`);
  }

  for (const priority of expectation.requiredPriorities) {
    if (!metrics.priorities.has(priority)) {
      throw new Error(
        `${name}: expected strategy at priority ${priority} to apply.`
      );
    }
  }
}

interface ScenarioConfig {
  name: string;
  counts: {
    history: number;
    examples: number;
    optional: number;
  };
  bodies: {
    historyRepeat: number;
    exampleRepeat: number;
    optionalRepeat: number;
  };
  bodyBase?: Partial<BodyBase>;
  truncateBudget: number;
  priorities: {
    summary: number;
    omit: number;
    truncate: number;
  };
  summary: {
    window: number;
    maxChars: number;
  };
  ids: {
    summary: string;
    examples: string;
    optional: string;
  };
  budgets: {
    fit: number;
    tight: number;
  };
  expectations?: {
    fit?: FitExpectation;
    tight?: FitExpectation;
  };
  benchOptions?: {
    time?: number;
    iterations?: number;
  };
}

interface ScenarioResult {
  name: string;
  summaryId: string;
  baselineTokens: number;
  budgets: ScenarioConfig["budgets"];
  expectations: Required<NonNullable<ScenarioConfig["expectations"]>>;
  prebuiltColdStore: InMemoryStore<StoredSummary>;
  prebuiltElement: PromptTree;
  prebuiltWarmElement: PromptTree;
  benchOptions?: {
    time?: number;
    iterations?: number;
  };
  renderColdBaseline: () => Promise<number>;
  renderPrebuiltBaseline: () => Promise<number>;
  renderPrebuiltFitCold: () => Promise<number>;
  renderPrebuiltTightWarm: () => Promise<number>;
}

async function createScenario(config: ScenarioConfig): Promise<ScenarioResult> {
  const base: BodyBase = { ...DEFAULT_BODY_BASE, ...config.bodyBase };
  const userBody = base.historyUser.repeat(config.bodies.historyRepeat);
  const assistantBody = base.historyAssistant.repeat(
    config.bodies.historyRepeat
  );
  const exampleBody = base.example.repeat(config.bodies.exampleRepeat);
  const optionalBody = base.optional.repeat(config.bodies.optionalRepeat);

  const historyMessages = buildHistoryMessages(
    config.counts.history,
    userBody,
    assistantBody
  );
  const exampleMessages = buildExampleMessages(
    config.counts.examples,
    exampleBody
  );
  const optionalMessages = buildOptionalMessages(
    config.counts.optional,
    optionalBody
  );

  function summarizeHistory(ctx: SummarizerContext): string {
    const lines = collectMessages(ctx.target);
    const windowed = lines.slice(-config.summary.window);
    const recentSummary = clampSummary(
      compact(windowed.join("\n")),
      config.summary.maxChars
    );

    if (ctx.existingSummary === null) {
      return `Summary: ${recentSummary}`;
    }

    const combined = clampSummary(
      compact(`${ctx.existingSummary}\nUpdate: ${recentSummary}`),
      config.summary.maxChars
    );
    return `Summary: ${combined}`;
  }

  function buildPrompt(store: InMemoryStore<StoredSummary>) {
    return cria
      .prompt(provider)
      .system(systemPrompt)
      .developer(developerPrompt)
      .summary(historyMessages, {
        id: config.ids.summary,
        store,
        summarize: summarizeHistory,
        priority: config.priorities.summary,
      })
      .truncate(exampleMessages, {
        budget: config.truncateBudget,
        from: "start",
        priority: config.priorities.truncate,
        id: config.ids.examples,
      })
      .omit(optionalMessages, {
        priority: config.priorities.omit,
        id: config.ids.optional,
      })
      .user(latestUserPrompt);
  }

  const prebuiltColdStore = new InMemoryStore<StoredSummary>();
  const prebuiltElement = await buildPrompt(prebuiltColdStore).build();

  const baselineRendered = await render(prebuiltElement, { provider });
  const baselineTokens = provider.countTokens(baselineRendered);

  const warmSummaryStore = new InMemoryStore<StoredSummary>();
  warmSummaryStore.set(config.ids.summary, {
    content:
      "Seed summary for warm-store benchmarking so the summary strategy can update an existing entry.",
  });
  const prebuiltWarmElement = await buildPrompt(warmSummaryStore).build();

  const expectations: Required<NonNullable<ScenarioConfig["expectations"]>> =
    config.expectations ?? {
      fit: {
        minIterations: 1,
        requiredPriorities: [config.priorities.summary],
      },
      tight: {
        minIterations: 1,
        requiredPriorities: [config.priorities.summary],
      },
    };

  async function renderWithBudget(params: {
    element: PromptTree;
    store: InMemoryStore<StoredSummary>;
    budgetKey: keyof ScenarioConfig["budgets"];
    resetSummary?: boolean;
  }): Promise<number> {
    const { element, store, budgetKey, resetSummary } = params;
    if (resetSummary) {
      store.delete(config.ids.summary);
    }

    const budget = config.budgets[budgetKey];
    const expectation = expectations[budgetKey];
    const { hooks, metrics } = createFitMetrics();

    try {
      const rendered = await render(element, { provider, budget, hooks });
      const tokens = provider.countTokens(rendered);
      assertExpectation({
        name: `${config.name}:${budgetKey}`,
        baselineTokens,
        budget,
        tokens,
        metrics,
        expectation,
      });
      return tokens;
    } catch (error) {
      if (error instanceof FitError) {
        throw error;
      }
      throw error;
    }
  }

  async function renderColdBaseline(): Promise<number> {
    const store = new InMemoryStore<StoredSummary>();
    const element = await buildPrompt(store).build();
    const rendered = await render(element, { provider });
    return provider.countTokens(rendered);
  }

  async function renderPrebuiltBaseline(): Promise<number> {
    const rendered = await render(prebuiltElement, { provider });
    return provider.countTokens(rendered);
  }

  function renderPrebuiltFitCold(): Promise<number> {
    return renderWithBudget({
      element: prebuiltElement,
      store: prebuiltColdStore,
      budgetKey: "fit",
      resetSummary: true,
    });
  }

  function renderPrebuiltTightWarm(): Promise<number> {
    return renderWithBudget({
      element: prebuiltWarmElement,
      store: warmSummaryStore,
      budgetKey: "tight",
      resetSummary: false,
    });
  }

  return {
    name: config.name,
    summaryId: config.ids.summary,
    baselineTokens,
    budgets: config.budgets,
    expectations,
    prebuiltColdStore,
    prebuiltElement,
    prebuiltWarmElement,
    benchOptions: config.benchOptions,
    renderColdBaseline,
    renderPrebuiltBaseline,
    renderPrebuiltFitCold,
    renderPrebuiltTightWarm,
  };
}

const standardScenario = await createScenario({
  name: "standard-summary-first",
  counts: {
    history: 120,
    examples: 48,
    optional: 24,
  },
  bodies: {
    historyRepeat: 3,
    exampleRepeat: 2,
    optionalRepeat: 2,
  },
  truncateBudget: 400,
  priorities: {
    summary: 3,
    omit: 2,
    truncate: 1,
  },
  summary: {
    window: 16,
    maxChars: 600,
  },
  ids: {
    summary: "bench-history",
    examples: "bench-examples",
    optional: "bench-optional",
  },
  budgets: {
    fit: 3000,
    tight: 1800,
  },
  expectations: {
    fit: {
      minIterations: 1,
      requiredPriorities: [3],
    },
    tight: {
      minIterations: 2,
      requiredPriorities: [3, 2],
    },
  },
});

const stressScenario = await createScenario({
  name: "standard-multi-strategy-stress",
  counts: {
    history: 120,
    examples: 48,
    optional: 24,
  },
  bodies: {
    historyRepeat: 3,
    exampleRepeat: 2,
    optionalRepeat: 2,
  },
  truncateBudget: 400,
  priorities: {
    summary: 1,
    omit: 3,
    truncate: 2,
  },
  summary: {
    window: 24,
    maxChars: 1000,
  },
  ids: {
    summary: "bench-history-stress",
    examples: "bench-examples-stress",
    optional: "bench-optional-stress",
  },
  budgets: {
    fit: 5000,
    tight: 3000,
  },
  expectations: {
    fit: {
      minIterations: 3,
      requiredPriorities: [3, 2, 1],
    },
    tight: {
      minIterations: 3,
      requiredPriorities: [3, 2, 1],
    },
  },
});

const hugeScenario = await createScenario({
  name: "huge-summary-first",
  counts: {
    history: 720,
    examples: 240,
    optional: 120,
  },
  bodies: {
    historyRepeat: 3,
    exampleRepeat: 2,
    optionalRepeat: 2,
  },
  truncateBudget: 1600,
  priorities: {
    summary: 3,
    omit: 2,
    truncate: 1,
  },
  summary: {
    window: 32,
    maxChars: 1200,
  },
  ids: {
    summary: "bench-history-huge",
    examples: "bench-examples-huge",
    optional: "bench-optional-huge",
  },
  budgets: {
    fit: 15_000,
    tight: 8000,
  },
  expectations: {
    fit: {
      minIterations: 1,
      requiredPriorities: [3],
    },
    tight: {
      minIterations: 2,
      requiredPriorities: [3, 2],
    },
  },
});

const longScenario = await createScenario({
  name: "long-20k-summary-first",
  counts: {
    history: 20_000,
    examples: 80,
    optional: 40,
  },
  bodies: {
    historyRepeat: 1,
    exampleRepeat: 1,
    optionalRepeat: 1,
  },
  bodyBase: {
    historyUser: "User context. ",
    historyAssistant: "Assistant context. ",
    example: "Example context. ",
    optional: "Optional context. ",
  },
  truncateBudget: 1200,
  priorities: {
    summary: 3,
    omit: 2,
    truncate: 1,
  },
  summary: {
    window: 24,
    maxChars: 800,
  },
  ids: {
    summary: "bench-history-20k",
    examples: "bench-examples-20k",
    optional: "bench-optional-20k",
  },
  budgets: {
    fit: 140_000,
    tight: 70_000,
  },
  expectations: {
    fit: {
      minIterations: 1,
      requiredPriorities: [3],
    },
    tight: {
      minIterations: 1,
      requiredPriorities: [3],
    },
  },
  benchOptions: {
    time: 800,
    iterations: 5,
  },
});

describe("golden render loop (standard summary-first)", () => {
  bench("build + render baseline (no fit loop)", async () => {
    await standardScenario.renderColdBaseline();
  });

  bench("render prebuilt baseline (no fit loop)", async () => {
    await standardScenario.renderPrebuiltBaseline();
  });

  bench("render prebuilt fit budget (cold summary store)", async () => {
    await standardScenario.renderPrebuiltFitCold();
  });

  bench("render prebuilt tight budget (warm summary store)", async () => {
    await standardScenario.renderPrebuiltTightWarm();
  });
});

describe("golden render loop (multi-strategy stress)", () => {
  bench("render prebuilt fit budget (cold summary store)", async () => {
    await stressScenario.renderPrebuiltFitCold();
  });
});

describe("golden render loop (huge trees)", () => {
  bench("build + render baseline (huge, no fit loop)", async () => {
    await hugeScenario.renderColdBaseline();
  });

  bench("render prebuilt baseline (huge, no fit loop)", async () => {
    await hugeScenario.renderPrebuiltBaseline();
  });

  bench("render prebuilt fit budget (huge, cold summary store)", async () => {
    await hugeScenario.renderPrebuiltFitCold();
  });

  bench("render prebuilt tight budget (huge, warm summary store)", async () => {
    await hugeScenario.renderPrebuiltTightWarm();
  });
});

describe("golden render loop (20k messages)", () => {
  const options = longScenario.benchOptions;

  bench(
    "render prebuilt baseline (20k, no fit loop)",
    async () => {
      await longScenario.renderPrebuiltBaseline();
    },
    options
  );

  bench(
    "render prebuilt fit budget (20k, cold summary store)",
    async () => {
      await longScenario.renderPrebuiltFitCold();
    },
    options
  );

  bench(
    "render prebuilt tight budget (20k, warm summary store)",
    async () => {
      await longScenario.renderPrebuiltTightWarm();
    },
    options
  );
});
