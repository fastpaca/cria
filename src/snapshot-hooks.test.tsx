import { describe, expect, test } from "vitest";
import { Omit, Region, render } from "./index";
import { createSnapshotHooks } from "./snapshot";

const tokenizer = (text: string): number => text.length;

describe("createSnapshotHooks", () => {
  test("invokes callback with snapshot on fit complete", async () => {
    const snapshots: string[] = [];
    const element = (
      <Region priority={0}>
        A<Omit priority={1}>BBBB</Omit>
      </Region>
    );

    const hooks = createSnapshotHooks({
      tokenizer,
      onSnapshot: (snapshot) => {
        snapshots.push(snapshot.hash);
      },
    });

    const result = await render(element, { tokenizer, budget: 1, hooks });
    expect(result).toBe("A");
    expect(snapshots).toHaveLength(1);
  });

  test("propagates errors from snapshot creation", async () => {
    const element = <Region priority={0}>Hi</Region>;

    const hooks = createSnapshotHooks({
      tokenizer: () => {
        throw new Error("tokenizer failed");
      },
      onSnapshot: () => {
        throw new Error("callback failed");
      },
    });

    await expect(
      render(element, { tokenizer, budget: 10, hooks })
    ).rejects.toThrow("tokenizer failed");
  });
});
