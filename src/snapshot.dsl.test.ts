import { describe, expect, test } from "vitest";
import { cria } from "./dsl";
import { createSnapshot, diffSnapshots } from "./snapshot";

const tokenizer = (text: string): number => Math.ceil(text.length / 4);

describe("DSL snapshots", () => {
  test("snapshot captures structure and tokens", async () => {
    const prompt = cria.prompt().system("Rules").user("Hello");

    const element = await prompt.build();
    const snap = createSnapshot(element, { tokenizer });

    expect(snap.totalTokens).toBeGreaterThan(0);
    expect(snap.root.children.length).toBe(2);
  });

  test("diffSnapshots detects changes", async () => {
    const base = cria.prompt().user("Hello");
    const changed = cria.prompt().user("Hello world");

    const baseSnap = createSnapshot(await base.build(), { tokenizer });
    const changedSnap = createSnapshot(await changed.build(), { tokenizer });

    const diff = diffSnapshots(baseSnap, changedSnap);
    expect(diff.changed.length).toBeGreaterThan(0);
  });
});
