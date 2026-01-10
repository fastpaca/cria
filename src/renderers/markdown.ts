import type { PromptChildren, PromptElement, PromptRenderer } from "../types";
import { safeStringify } from "./shared";

export const markdownRenderer: PromptRenderer<string> = {
  name: "markdown",
  tokenString: (element) => renderToMarkdown(element),
  render: (element) => renderToMarkdown(element),
  empty: () => "",
};

const ROLE_LABELS: Record<string, string> = {
  system: "System",
  user: "User",
  assistant: "Assistant",
};

function renderToMarkdown(element: PromptElement): string {
  switch (element.kind) {
    case "message": {
      const content = renderChildrenToMarkdown(element.children).trimEnd();
      const label = ROLE_LABELS[element.role] ?? element.role;
      return `${label}: ${content}\n\n`;
    }
    case "reasoning": {
      return `<thinking>\n${element.text}\n</thinking>\n`;
    }
    case "tool-call": {
      const inputText = safeStringify(element.input, true);
      return `<tool_call name="${element.toolName}">\n${inputText}\n</tool_call>\n`;
    }
    case "tool-result": {
      const outputText = safeStringify(element.output, true);
      return `<tool_result name="${element.toolName}">\n${outputText}\n</tool_result>\n`;
    }
    default: {
      return renderChildrenToMarkdown(element.children);
    }
  }
}

function renderChildrenToMarkdown(children: PromptChildren): string {
  let result = "";
  for (const child of children) {
    result += typeof child === "string" ? child : renderToMarkdown(child);
  }
  return result;
}
