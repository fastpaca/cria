import type { PromptPlugin, ScopeContent } from "../dsl/builder";
import type { InputLayout } from "../provider";
import type { PromptLayout, ProviderToolIO, ToolIOForProvider } from "../types";

type HistoryContent<P> = ScopeContent<P> | PromptLayout<ToolIOForProvider<P>>;

export interface HistoryOptions<P = unknown> {
  history: HistoryContent<P>;
}

const isPromptLayout = (
  value: unknown
): value is PromptLayout<ProviderToolIO> => {
  if (!Array.isArray(value)) {
    return false;
  }

  for (const item of value) {
    if (typeof item !== "object" || item === null) {
      return false;
    }
    if ("kind" in item || !("role" in item)) {
      return false;
    }
  }

  return true;
};

const toScopeContent = <P>(history: HistoryContent<P>): ScopeContent<P> => {
  if (!isPromptLayout(history)) {
    return history;
  }

  const layoutInput: InputLayout<ToolIOForProvider<P>> = {
    kind: "input-layout",
    value: history as PromptLayout<ToolIOForProvider<P>>,
  };
  return layoutInput;
};

export const history = <P = unknown>(
  options: HistoryOptions<P>
): PromptPlugin<P> => {
  return {
    render() {
      return toScopeContent(options.history);
    },
  };
};
