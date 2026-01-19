import { getEncoding } from "js-tiktoken";

// Shared tiktoken encoder - only instantiated once
const encoder = getEncoding("cl100k_base");

/**
 * Count tokens in a string using cl100k_base encoding.
 */
export const countText = (text: string): number => encoder.encode(text).length;
