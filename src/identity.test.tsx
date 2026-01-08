import { describe, expect, it } from "vitest";
import { Region } from "./components";
import { assignPromptElementIds, locatePromptElementPath } from "./identity";

const hash = (input: string): string => `h:${input}`;

describe("locatePromptElementPath", () => {
  it("returns a path for a nested element", async () => {
    const target = await <Region priority={1}>Target</Region>;
    const root = await (
      <Region priority={0}>
        Before {target} After
      </Region>
    );

    const path = locatePromptElementPath(root, target);
    expect(path).toEqual([1]);
  });

  it("returns null when the target is not in the tree", async () => {
    const root = await <Region priority={0}>Hello</Region>;
    const other = await <Region priority={1}>Other</Region>;

    expect(locatePromptElementPath(root, other)).toBeNull();
  });
});

describe("assignPromptElementIds", () => {
  it("assigns deterministic content-hash ids", async () => {
    const element = await (
      <Region priority={0}>
        Hello <Region priority={1}>Inner</Region>
      </Region>
    );

    const first = assignPromptElementIds(element, { hash });
    const second = assignPromptElementIds(element, { hash });

    expect(first.id).toBe(second.id);
    const firstChild = first.children[1];
    const secondChild = second.children[1];
    if (typeof firstChild === "string" || typeof secondChild === "string") {
      throw new Error("Expected element child for hash test");
    }
    expect(firstChild.id).toBe(secondChild.id);
  });

  it("changes ids when content changes", async () => {
    const base = await <Region priority={0}>Hello</Region>;
    const changed = await <Region priority={0}>Hello!</Region>;

    const baseIds = assignPromptElementIds(base, { hash });
    const changedIds = assignPromptElementIds(changed, { hash });

    expect(baseIds.id).not.toBe(changedIds.id);
  });

  it("preserves user-provided ids", async () => {
    const element = await (
      <Region id="root" priority={0}>
        <Region id="child" priority={1}>
          Hello
        </Region>
      </Region>
    );

    const assigned = assignPromptElementIds(element, { hash });
    expect(assigned.id).toBe("root");
    const child = assigned.children[0];
    if (typeof child === "string") {
      throw new Error("Expected element child for id test");
    }
    expect(child.id).toBe("child");
  });

  it("handles hash collisions deterministically", async () => {
    const element = await (
      <Region priority={0}>
        <Region priority={1}>One</Region>
        <Region priority={1}>Two</Region>
      </Region>
    );

    const assigned = assignPromptElementIds(element, {
      preserveExistingIds: false,
      hash: () => "same",
    });

    const childA = assigned.children[0];
    const childB = assigned.children[1];
    if (typeof childA === "string" || typeof childB === "string") {
      throw new Error("Expected element children for collision test");
    }

    expect(childA.id).toBe("same");
    expect(childB.id).toBe("same-1");
  });

  it("throws when hash is missing", async () => {
    const element = await <Region priority={0}>Hello</Region>;

    expect(() => assignPromptElementIds(element)).toThrow(
      /requires options\.hash/
    );
  });
});
