import { describe, expect, it } from "vitest";
import { Region } from "./components";
import {
  assertPromptElementIdsUnique,
  findDuplicatePromptElementIds,
} from "./ir-validate";

describe("findDuplicatePromptElementIds", () => {
  it("returns duplicate ids in the tree", async () => {
    const root = await (
      <Region id="root" priority={0}>
        <Region id="dup" priority={1}>
          One
        </Region>
        <Region id="dup" priority={1}>
          Two
        </Region>
      </Region>
    );

    expect(findDuplicatePromptElementIds(root)).toEqual(["dup"]);
  });

  it("returns empty when ids are unique", async () => {
    const root = await (
      <Region id="root" priority={0}>
        <Region id="a" priority={1}>
          One
        </Region>
        <Region id="b" priority={1}>
          Two
        </Region>
      </Region>
    );

    expect(findDuplicatePromptElementIds(root)).toEqual([]);
  });
});

describe("assertPromptElementIdsUnique", () => {
  it("does not throw when ids are unique", async () => {
    const root = await (
      <Region id="root" priority={0}>
        <Region id="a" priority={1}>
          One
        </Region>
      </Region>
    );

    expect(() => assertPromptElementIdsUnique(root)).not.toThrow();
  });

  it("throws when ids are duplicated", async () => {
    const root = await (
      <Region id="root" priority={0}>
        <Region id="dup" priority={1}>
          One
        </Region>
        <Region id="dup" priority={1}>
          Two
        </Region>
      </Region>
    );

    expect(() => assertPromptElementIdsUnique(root)).toThrow(
      /Duplicate ids: dup/
    );
  });
});
