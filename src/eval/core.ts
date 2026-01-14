import type { ZodError } from "zod";
import { cria, type PromptBuilder } from "../dsl";
import { markdownRenderer } from "../renderers/markdown";
import {
  coalesceTextParts,
  collectMessageNodes,
  collectSemanticParts,
  type SemanticPart,
  safeStringify,
} from "../renderers/shared";
import type {
  CompletionMessage,
  EvaluatorOutput,
  EvaluatorProvider,
  ModelProvider,
  PromptElement,
  PromptRenderer,
  Tokenizer,
} from "../types";
import { EvaluatorOutputSchema } from "../types";

export type {
  EvaluatorOutput,
  EvaluatorProvider,
  EvaluatorRequest,
} from "../types";
export { EvaluatorOutputSchema } from "../types";

export const DEFAULT_THRESHOLD = 0.8;

/**
 * Options for evaluating a prompt.
 */
export interface EvalOptions {
  /** Model provider to generate the prompt response under test */
  target: ModelProvider;
  /** Evaluator provider that returns structured output (recommend: gpt-4o-mini for cost/quality balance) */
  evaluator: EvaluatorProvider;
  /** Input variables to substitute into the prompt template */
  input: Record<string, unknown>;
  /** Criteria to evaluate against (e.g. ["helpful", "accurate"]) */
  criteria?: string[];
  /** Expected output for comparison (optional) */
  expected?: string;
  /** Minimum score to pass (default: 0.8) */
  threshold?: number;
  /** Tokenizer for rendering the target prompt (optional, uses target tokenizer if available) */
  targetTokenizer?: Tokenizer;
  /** Token budget for rendering the target prompt (optional, defaults to 100000) */
  targetBudget?: number;
  /** Tokenizer for rendering the evaluator prompt (optional, uses evaluator tokenizer if available) */
  evaluatorTokenizer?: Tokenizer;
  /** Token budget for rendering the evaluator prompt (optional, defaults to 100000) */
  evaluatorBudget?: number;
}

/**
 * Result from evaluating a prompt.
 */
export interface EvalResult {
  /** Whether the evaluation passed (score >= threshold) */
  passed: boolean;
  /** Numeric score from 0 to 1 */
  score: number;
  /** Evaluator's reasoning for the score */
  reasoning: string;
  /** The actual response from the prompt being evaluated */
  response: string;
}

/**
 * Options for creating a mock evaluator for testing.
 */
export interface MockEvaluatorOptions {
  /** Fixed score to return (0-1) */
  score?: number;
  /** Fixed reasoning to return */
  reasoning?: string;
}

/**
 * Options for creating a mock target model for testing.
 */
export interface MockTargetOptions {
  /** Fixed response to return from prompt execution */
  response?: string;
}

export class EvalError extends Error {
  readonly code: string;

  constructor(message: string, code: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "EvalError";
    this.code = code;
  }
}

export class EvalSchemaError extends EvalError {
  readonly zodError: ZodError;
  readonly rawOutput: unknown;

  constructor(zodError: ZodError, rawOutput: unknown) {
    super(
      `Evaluator output did not match expected schema: ${zodError.message}`,
      "EVAL_SCHEMA_ERROR"
    );
    this.name = "EvalSchemaError";
    this.zodError = zodError;
    this.rawOutput = rawOutput;
  }
}

export class EvalTargetError extends EvalError {
  readonly provider: string;

  constructor(provider: string, cause: unknown) {
    super(
      `Target provider "${provider}" failed to generate a response.`,
      "EVAL_TARGET_ERROR",
      { cause }
    );
    this.name = "EvalTargetError";
    this.provider = provider;
  }
}

export class EvalEvaluatorError extends EvalError {
  readonly provider: string;

  constructor(provider: string, cause: unknown) {
    super(
      `Evaluator provider "${provider}" failed to score the response.`,
      "EVAL_EVALUATOR_ERROR",
      { cause }
    );
    this.name = "EvalEvaluatorError";
    this.provider = provider;
  }
}

/**
 * Build the evaluator prompt using Cria (dogfooding!).
 *
 * Uses structured output for reliable evaluations.
 */
function buildEvaluatorPrompt(options: {
  input: Record<string, unknown>;
  response: string;
  criteria?: string[];
  expected?: string;
}): PromptBuilder {
  const criteriaList =
    options.criteria && options.criteria.length > 0
      ? options.criteria.map((c) => `- ${c}`).join("\n")
      : "- Overall quality and correctness";

  const expectedSection = options.expected
    ? `

## Expected Response (for comparison)
${options.expected}`
    : "";

  return cria
    .prompt()
    .system(
      `You are an expert evaluator for LLM outputs. Assess response quality against the criteria.

Return a JSON object with:
- score: number from 0.0 to 1.0
- reasoning: short explanation

Do not include any other text.

Scoring guide:
- 1.0: Exceptional, exceeds all criteria
- 0.8-0.9: Good, meets criteria with minor issues
- 0.6-0.7: Acceptable, meets most criteria
- 0.4-0.5: Below expectations, significant gaps
- 0.0-0.3: Poor, fails to meet criteria`
    )
    .user(
      `## Input
${JSON.stringify(options.input, null, 2)}

## Response to Evaluate
${options.response}

## Evaluation Criteria
${criteriaList}${expectedSection}`
    );
}

function substituteVariables(
  text: string,
  input: Record<string, unknown>
): string {
  let result = text;
  for (const [key, value] of Object.entries(input)) {
    const placeholder = `{{${key}}}`;
    const stringValue =
      typeof value === "string" ? value : JSON.stringify(value);
    result = result.split(placeholder).join(stringValue);
  }
  return result;
}

const completionMessagesRenderer: PromptRenderer<CompletionMessage[]> = {
  name: "completion-messages",
  tokenString: markdownRenderer.tokenString,
  render: (element) => renderToCompletionMessages(element),
  empty: () => [],
};

function renderToCompletionMessages(
  element: PromptElement
): CompletionMessage[] {
  const messageNodes = collectMessageNodes(element);
  if (messageNodes.length === 0) {
    const fallback = markdownRenderer.render(element);
    if (fallback.length === 0) {
      return [];
    }

    return [{ role: "user", content: fallback }];
  }

  const messages: CompletionMessage[] = [];
  for (const messageNode of messageNodes) {
    const parts = coalesceTextParts(collectSemanticParts(messageNode.children));
    const content = semanticPartsToContent(parts);
    if (content.length === 0) {
      continue;
    }

    messages.push({ role: messageNode.role, content });
  }

  return messages;
}

function extractSystemPrompt(
  messages: CompletionMessage[]
): string | undefined {
  const systemParts: string[] = [];

  for (const message of messages) {
    if (message.role === "system") {
      systemParts.push(message.content);
    }
  }

  if (systemParts.length === 0) {
    return undefined;
  }

  return systemParts.join("\n");
}

function semanticPartsToContent(parts: readonly SemanticPart[]): string {
  let result = "";

  for (const part of parts) {
    switch (part.type) {
      case "text":
        result += part.text;
        break;
      case "reasoning":
        result += `<thinking>\n${part.text}\n</thinking>\n`;
        break;
      case "tool-call":
        result += `<tool_call name="${part.toolName}">\n${safeStringify(part.input, true)}\n</tool_call>\n`;
        break;
      case "tool-result":
        result += `<tool_result name="${part.toolName}">\n${safeStringify(part.output, true)}\n</tool_result>\n`;
        break;
      default:
        break;
    }
  }

  return result;
}

async function renderPromptToString(
  prompt: PromptBuilder | PromptElement,
  options: {
    tokenizer?: Tokenizer;
    budget?: number;
    input: Record<string, unknown>;
  }
): Promise<string> {
  const { render } = await import("../render");

  const tokenizer = options.tokenizer ?? ((text: string) => text.length);
  const budget = options.budget ?? 100_000;

  let element: PromptElement;
  if ("build" in prompt && typeof prompt.build === "function") {
    element = await prompt.build();
  } else {
    element = prompt as PromptElement;
  }

  const rendered = await render(element, {
    tokenizer,
    budget,
    renderer: markdownRenderer,
  });

  return substituteVariables(rendered, options.input);
}

async function renderPromptToMessages(
  prompt: PromptBuilder | PromptElement,
  options: {
    tokenizer?: Tokenizer;
    budget?: number;
    input: Record<string, unknown>;
  }
): Promise<CompletionMessage[]> {
  const { render } = await import("../render");

  const tokenizer = options.tokenizer ?? ((text: string) => text.length);
  const budget = options.budget ?? 100_000;

  let element: PromptElement;
  if ("build" in prompt && typeof prompt.build === "function") {
    element = await prompt.build();
  } else {
    element = prompt as PromptElement;
  }

  const rendered = await render(element, {
    tokenizer,
    budget,
    renderer: completionMessagesRenderer,
  });

  return rendered.map((message) => ({
    ...message,
    content: substituteVariables(message.content, options.input),
  }));
}

function parseEvaluatorOutput(output: unknown): EvaluatorOutput {
  const result = EvaluatorOutputSchema.safeParse(output);

  if (!result.success) {
    throw new EvalSchemaError(result.error, output);
  }

  return result.data;
}

/**
 * Evaluate a prompt using an LLM evaluator.
 *
 * The evaluation process:
 * 1. Render the prompt with the given input variables
 * 2. Execute the prompt against a model (using the target provider)
 * 3. Have the evaluator evaluate the response against the criteria
 * 4. Return structured results with score, pass/fail, and reasoning
 *
 * @example
 * ```typescript
 * const result = await evaluate(myPrompt, {
 *   target: openaiProvider,
 *   evaluator: evaluatorProvider,
 *   input: { question: "What is 2+2?" },
 *   criteria: ["accurate", "concise"],
 *   threshold: 0.8,
 * });
 *
 * expect(result.passed).toBe(true);
 * expect(result.score).toBeGreaterThan(0.8);
 * ```
 */
export async function evaluate(
  prompt: PromptBuilder | PromptElement,
  options: EvalOptions
): Promise<EvalResult> {
  const {
    target,
    evaluator,
    input,
    criteria,
    expected,
    threshold = DEFAULT_THRESHOLD,
    targetTokenizer,
    targetBudget,
    evaluatorTokenizer,
    evaluatorBudget,
  } = options;

  // Step 1: Render the prompt to structured messages with variables substituted
  const renderTokenizer = targetTokenizer ?? target.tokenizer;
  const renderedMessages = await renderPromptToMessages(prompt, {
    ...(renderTokenizer && { tokenizer: renderTokenizer }),
    ...(targetBudget !== undefined && { budget: targetBudget }),
    input,
  });
  const system = extractSystemPrompt(renderedMessages);

  // Step 2: Execute the prompt to get a response
  let promptResponse: { text: string };
  try {
    promptResponse = await target.completion({
      messages: renderedMessages,
      ...(system !== undefined && { system }),
    });
  } catch (error) {
    throw new EvalTargetError(target.name, error);
  }

  const response = promptResponse.text;

  // Step 3: Build and render the evaluator prompt using Cria (dogfooding!)
  const evaluatorPrompt = buildEvaluatorPrompt({
    input,
    response,
    ...(criteria && { criteria }),
    ...(expected && { expected }),
  });

  const evaluatorRenderTokenizer = evaluatorTokenizer ?? evaluator.tokenizer;
  const evaluatorRendered = await renderPromptToString(evaluatorPrompt, {
    ...(evaluatorRenderTokenizer && { tokenizer: evaluatorRenderTokenizer }),
    ...(evaluatorBudget !== undefined && { budget: evaluatorBudget }),
    input: {}, // Evaluator prompt has no variables
  });

  // Step 4: Execute the evaluator prompt
  let evaluatorResponse: EvaluatorOutput;
  try {
    evaluatorResponse = await evaluator.evaluate({
      prompt: evaluatorRendered,
      input,
      response,
      ...(criteria && { criteria }),
      ...(expected && { expected }),
    });
  } catch (error) {
    if (error instanceof EvalError) {
      throw error;
    }
    throw new EvalEvaluatorError(evaluator.name, error);
  }

  // Step 5: Parse and return the evaluation result
  const evaluation = parseEvaluatorOutput(evaluatorResponse);

  return {
    passed: evaluation.score >= threshold,
    score: evaluation.score,
    reasoning: evaluation.reasoning,
    response,
  };
}

/**
 * Create a mock evaluator for testing evaluations without making LLM calls.
 *
 * @example
 * ```typescript
 * import { evaluate, mockEvaluator, mockTarget } from "@fastpaca/cria/eval";
 *
 * const result = await evaluate(myPrompt, {
 *   target: mockTarget(),
 *   evaluator: mockEvaluator({ score: 0.9 }),
 *   input: { question: "Test question" },
 *   criteria: ["accurate"],
 * });
 *
 * expect(result.score).toBe(0.9);
 * expect(result.passed).toBe(true);
 * ```
 */
export function mockEvaluator(
  options: MockEvaluatorOptions = {}
): EvaluatorProvider {
  const {
    score = 0.85,
    reasoning = "Mock evaluation - all criteria met satisfactorily.",
  } = options;

  return {
    name: "mock-evaluator",
    evaluate: () => ({ score, reasoning }),
  };
}

/**
 * Create a mock target model for testing prompt execution.
 */
export function mockTarget(options: MockTargetOptions = {}): ModelProvider {
  const { response = "Mock response from the prompt under evaluation." } =
    options;

  return {
    name: "mock-target",
    completion: () => Promise.resolve({ text: response }),
  };
}
