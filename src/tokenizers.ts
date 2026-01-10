import type { Tokenizer } from "./types";

/**
 * Rough heuristic tokenizer: ~4 characters per token.
 *
 * Suitable as a default estimate when no model-specific tokenizer is available.
 * For accurate budgeting, pass a model-aware tokenizer (e.g. tiktoken).
 */
export const approximateTokenizer: Tokenizer = (text) =>
  Math.ceil(text.length / 4);
