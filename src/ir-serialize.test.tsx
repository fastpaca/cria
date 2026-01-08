import { expect, test } from "vitest";
import { Region, ToolCall, inspectPromptElement, serializePromptElement } from "./index";

test("serializePromptElement uses custom serializer", async () => {
  const element = await (
    <ToolCall toolCallId="call-1" toolName="lookup" input={{ value: 42 }} />
  );

  const serialized = serializePromptElement(element, {
    serializeData: () => "custom",
  });

  expect(serialized.input).toBe("custom");
});

test("inspectPromptElement returns JSON for IR", async () => {
  const element = await <Region priority={1}>Hello</Region>;
  const output = inspectPromptElement(element, { indent: 2 });
  const parsed = JSON.parse(output) as { children: unknown; priority: number };

  expect(parsed.priority).toBe(1);
  expect(parsed.children).toEqual(["Hello"]);
});
