import { expect, test } from "vitest";

import {
  JsonValueSchema,
  PromptChildrenSchema,
  PromptElementSchema,
} from "./types";

test("PromptElementSchema: accepts minimal region", () => {
  const result = PromptElementSchema.safeParse({
    priority: 0,
    children: ["Hello"],
  });

  expect(result.success).toBe(true);
  if (result.success) {
    expect(result.data.children).toEqual(["Hello"]);
  }
});

test("PromptElementSchema: accepts message kind", () => {
  const result = PromptElementSchema.safeParse({
    priority: 1,
    kind: "message",
    role: "user",
    children: [],
  });

  expect(result.success).toBe(true);
  if (result.success) {
    expect(result.data.kind).toBe("message");
    expect(result.data.role).toBe("user");
  }
});

test("PromptElementSchema: rejects invalid shape", () => {
  const result = PromptElementSchema.safeParse({
    priority: 0,
    children: "not-an-array",
  });

  expect(result.success).toBe(false);
});

test("PromptChildrenSchema: accepts mixed children", () => {
  const result = PromptChildrenSchema.safeParse([
    "Text",
    {
      priority: 2,
      kind: "reasoning",
      text: "thinking",
      children: [],
    },
  ]);

  expect(result.success).toBe(true);
  if (result.success) {
    expect(result.data).toHaveLength(2);
  }
});

test("JsonValueSchema: accepts nested values", () => {
  const result = JsonValueSchema.safeParse({
    ok: true,
    count: 3,
    label: "value",
    list: [1, "two", null, { deep: [false] }],
  });

  expect(result.success).toBe(true);
});

test("JsonValueSchema: rejects non-json values", () => {
  const result = JsonValueSchema.safeParse({
    bad: () => "nope",
  });

  expect(result.success).toBe(false);
});
