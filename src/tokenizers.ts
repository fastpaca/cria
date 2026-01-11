import {
  encodingForModel,
  getEncoding,
  type Tiktoken,
  type TiktokenModel,
} from "js-tiktoken";
import type { Tokenizer } from "./types";

/**
 * Rough heuristic tokenizer: ~4 characters per token.
 *
 * Suitable as a default estimate when no model-specific tokenizer is available.
 * For accurate budgeting, pass a model-aware tokenizer (e.g. tiktoken).
 */
export const approximateTokenizer: Tokenizer = (text) =>
  Math.ceil(text.length / 4);

const tiktokenCache = new Map<string, Tiktoken>();

function getTiktokenEncoder(modelHint?: string): Tiktoken | null {
  const cacheKey = modelHint ?? "cl100k_base";
  const cached = tiktokenCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  try {
    const encoder = modelHint
      ? encodingForModel(modelHint as TiktokenModel)
      : getEncoding("cl100k_base");
    tiktokenCache.set(cacheKey, encoder);
    return encoder;
  } catch (error) {
    // Fall through to allow approximate fallback
    const debugEnv = (process.env as NodeJS.ProcessEnv & { DEBUG?: string })
      .DEBUG;
    if (debugEnv?.includes("cria:tokenizer")) {
      // eslint-disable-next-line no-console
      console.warn("Falling back to approximate tokenizer:", error);
    }
    return null;
  }
}

/**
 * Best-effort tokenizer using tiktoken. Falls back to approximate if the encoding
 * is unavailable.
 */
export function tiktokenTokenizer(modelHint?: string): Tokenizer {
  const encoder = getTiktokenEncoder(modelHint);
  if (!encoder) {
    return approximateTokenizer;
  }

  return (text: string) => encoder.encode(text).length;
}
