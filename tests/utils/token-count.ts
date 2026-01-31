import { getEncoding } from "js-tiktoken";

const encoder = getEncoding("cl100k_base");

export const countTextTokens = (text: string): number =>
  encoder.encode(text).length;
