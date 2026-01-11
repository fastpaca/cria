import { expect, test } from "vitest";
import { Message } from "./components";
import { Fragment, jsx } from "./jsx";

test("optional JSX entry renders a message", async () => {
  const element = await jsx(Message, {
    messageRole: "user",
    children: "hi",
    priority: 1,
  });

  expect(element.kind).toBe("message");
  expect(element.role).toBe("user");
  expect(element.priority).toBe(1);
  expect(element.children).toEqual(["hi"]);
});

test("optional JSX entry supports Fragment and string children", async () => {
  const element = await jsx(Fragment, { children: ["a", "b"] });
  expect(element.children).toEqual(["a", "b"]);
});
