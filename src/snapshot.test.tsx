import { describe, expect, test } from "vitest";
import { Omit, Region } from "./components";
import { createSnapshot, createSnapshotHooks, diffSnapshots } from "./snapshot";
import { render } from "./render";

const tokenizer = (text: string): number => text.length;

const buildBaseTree = () => (
  <Region priority={0}>
    Intro
    <Region priority={1}>Keep</Region>
    <Omit priority={2}>Drop</Omit>
  </Region>
);

const buildChangedTree = () => (
  <Region priority={0}>
    Intro updated
    <Region priority={1}>Keep</Region>
    <Region priority={2}>Replace</Region>
  </Region>
);

describe("createSnapshot", () => {
  test("produces deterministic snapshots for the same input", async () => {
    const element = await buildBaseTree();
    const first = createSnapshot(element, { tokenizer });
    const second = createSnapshot(element, { tokenizer });

    expect(first.hash).toBe(second.hash);
    expect(first.root).toEqual(second.root);
    expect(first.totalTokens).toBe(second.totalTokens);
  });

  test("hash changes when structural content changes", async () => {
    const base = createSnapshot(await buildBaseTree(), { tokenizer });
    const changed = createSnapshot(await buildChangedTree(), { tokenizer });

    expect(base.hash).not.toBe(changed.hash);
  });
});

describe("diffSnapshots", () => {
  test("reports changed nodes and no false adds/removals when shapes align", async () => {
    const base = createSnapshot(await buildBaseTree(), { tokenizer });
    const changed = createSnapshot(await buildChangedTree(), { tokenizer });

    const diff = diffSnapshots(base, changed);
    const changedPaths = diff.changed
      .map((entry) => entry.path.join("."))
      .sort();

    expect(diff.added).toHaveLength(0);
    expect(diff.removed).toHaveLength(0);
    expect(changedPaths).toEqual(["", "0", "2", "2.0"]);
  });
});

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
