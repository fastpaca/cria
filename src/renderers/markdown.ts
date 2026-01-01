import type { PromptChildren, PromptElement, PromptRenderer } from "../types";

export const markdownRenderer: PromptRenderer<string> = {
  name: "markdown",
  tokenString: (element) => renderToMarkdown(element),
  render: (element) => renderToMarkdown(element),
  empty: () => "",
};

function renderToMarkdown(element: PromptElement): string {
  switch (element.kind) {
    case "message": {
      const content = renderChildrenToMarkdown(element.children).trimEnd();
      return `### ${element.role}\n\n${content}\n\n`;
    }
    case "reasoning": {
      return `#### Reasoning\n\n\`\`\`text\n${element.text}\n\`\`\`\n\n`;
    }
    case "tool-call": {
      const inputText = safeJsonStringify(element.input);
      return `#### Tool Call: \`${element.toolName}\` (\`${element.toolCallId}\`)\n\n\`\`\`json\n${inputText}\n\`\`\`\n\n`;
    }
    case "tool-result": {
      const outputText = safeJsonStringify(element.output);
      return `#### Tool Result: \`${element.toolName}\` (\`${element.toolCallId}\`)\n\n\`\`\`json\n${outputText}\n\`\`\`\n\n`;
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

function safeJsonStringify(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value === undefined) {
    return "undefined";
  }

  try {
    return JSON.stringify(value, null, 2) ?? "null";
  } catch {
    return String(value);
  }
}
