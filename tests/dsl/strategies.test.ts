import { cria } from "@fastpaca/cria/dsl";
import { render } from "@fastpaca/cria/render";
import { describe, expect, test } from "vitest";
import { createTestProvider } from "../utils/plaintext";

const provider = createTestProvider({
  includeRolePrefix: true,
  joinMessagesWith: "\n\n",
});
const tokensFor = (text: string): number => provider.countTokens(text);

describe("strategies", () => {
  test("truncate() shrinks scoped messages", async () => {
    const chunk = "x".repeat(50);
    const element = await cria
      .prompt()
      .truncate(cria.prompt().user(chunk).user(chunk).user(chunk), {
        budget: 500, // High budget = drop fewer children per iteration
        priority: 1,
      })
      .build();

    const full = `user: ${chunk}\n\nuser: ${chunk}\n\nuser: ${chunk}`;
    const result = await render(element, {
      provider,
      budget: Math.max(0, tokensFor(full) - 1),
    });
    expect(result).toContain("user:");
    expect(result.length).toBeLessThan(full.length);
  });

  test("omit() drops scoped messages", async () => {
    const element = await cria
      .prompt()
      .system("Required.")
      .omit(cria.prompt().system("Optional content"), { priority: 2 })
      .build();

    const result = await render(element, {
      provider,
      budget: tokensFor("system: Required."),
    });
    expect(result).toBe("system: Required.");
  });
});
