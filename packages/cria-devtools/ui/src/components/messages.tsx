import type { DevtoolsMessageSnapshot } from "@shared/types";
import { type ReactNode, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { deepParseJson } from "../utils/json";
import { CollapsibleSection, MessageTextBlock } from "./common";
import { JsonViewer } from "./json-viewer";

export const ROLE_CONFIG: Record<
  string,
  { icon: string; label: string; className: string }
> = {
  system: { icon: "S", label: "System", className: "role-system" },
  user: { icon: "U", label: "User", className: "role-user" },
  assistant: { icon: "A", label: "Assistant", className: "role-assistant" },
  tool: { icon: "T", label: "Tool", className: "role-tool" },
};

export interface MessageTurn {
  assistant: DevtoolsMessageSnapshot;
  toolResults: DevtoolsMessageSnapshot[];
}

const isEmptyAssistant = (msg: DevtoolsMessageSnapshot): boolean => {
  return (
    msg.role === "assistant" &&
    !msg.text &&
    !msg.reasoning &&
    (!msg.toolCalls || msg.toolCalls.length === 0)
  );
};

export const groupMessagesIntoTurns = (
  messages: DevtoolsMessageSnapshot[]
): Array<DevtoolsMessageSnapshot | MessageTurn> => {
  const result: Array<DevtoolsMessageSnapshot | MessageTurn> = [];
  let i = 0;

  while (i < messages.length) {
    const msg = messages[i];

    if (msg.role === "assistant" && msg.toolCalls && msg.toolCalls.length > 0) {
      const turn: MessageTurn = { assistant: msg, toolResults: [] };
      const toolCallIds = new Set(msg.toolCalls.map((tc) => tc.toolCallId));

      let j = i + 1;
      while (j < messages.length && messages[j].role === "tool") {
        const toolMsg = messages[j];
        if (toolMsg.toolResults?.some((tr) => toolCallIds.has(tr.toolCallId))) {
          turn.toolResults.push(toolMsg);
        }
        j++;
      }

      result.push(turn);
      i = j;
    } else if (
      isEmptyAssistant(msg) &&
      i + 1 < messages.length &&
      messages[i + 1].role === "tool"
    ) {
      const turn: MessageTurn = { assistant: msg, toolResults: [] };

      let j = i + 1;
      while (j < messages.length && messages[j].role === "tool") {
        turn.toolResults.push(messages[j]);
        j++;
      }

      result.push(turn);
      i = j;
    } else {
      result.push(msg);
      i++;
    }
  }

  return result;
};

export const isTurn = (
  item: DevtoolsMessageSnapshot | MessageTurn
): item is MessageTurn => {
  return "assistant" in item && "toolResults" in item;
};

export const MessageContent = ({
  text,
  renderMarkdown,
}: {
  text: string;
  renderMarkdown: boolean;
}) => {
  return (
    <MessageTextBlock
      className={renderMarkdown ? "markdown" : "plain"}
      contentLength={text.length}
    >
      {renderMarkdown ? (
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
      ) : (
        <pre>{text}</pre>
      )}
    </MessageTextBlock>
  );
};

const ToolInvocation = ({
  call,
  result,
}: {
  call: { toolCallId: string; toolName: string; input: unknown };
  result?: { toolCallId: string; toolName: string; output: unknown };
}) => {
  const [isOpen, setIsOpen] = useState(true);
  const parsedInput = deepParseJson(call.input);
  const parsedOutput = result ? deepParseJson(result.output) : null;
  const hasOutput = result !== undefined;
  const hasInput =
    parsedInput &&
    typeof parsedInput === "object" &&
    Object.keys(parsedInput as object).length > 0;

  return (
    <div className="tool-invocation">
      <button
        className="tool-invocation-header"
        onClick={() => setIsOpen(!isOpen)}
        type="button"
      >
        <span className="tool-invocation-icon">{isOpen ? "▼" : "▶"}</span>
        <span className="tool-invocation-name">{call.toolName}</span>
        <span className="tool-invocation-id">{call.toolCallId}</span>
        {result && <span className="tool-invocation-status">done</span>}
      </button>
      {isOpen && (
        <div className="tool-invocation-body">
          {hasInput && (
            <div className="tool-invocation-section">
              <div className="tool-invocation-label">Input</div>
              <JsonViewer value={parsedInput} />
            </div>
          )}
          {hasOutput && (
            <div className="tool-invocation-section">
              <div className="tool-invocation-label">Output</div>
              <JsonViewer value={parsedOutput} />
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export const MessageCardShell = ({
  message,
  badge,
  showConnector = false,
  children,
}: {
  message: DevtoolsMessageSnapshot;
  badge?: ReactNode;
  showConnector?: boolean;
  children?: ReactNode;
}) => {
  const roleConfig = ROLE_CONFIG[message.role] ?? {
    icon: "?",
    label: message.role,
    className: "role-unknown",
  };

  return (
    <div className={`timeline-item ${showConnector ? "has-connector" : ""}`}>
      <div className="timeline-marker">
        <span className={`timeline-dot ${roleConfig.className}`}>
          {roleConfig.icon}
        </span>
        {showConnector && <div className="timeline-line" />}
      </div>
      <article className={`message-card ${roleConfig.className}`}>
        <header className="message-header">
          <div className="message-role">
            <span className="role-label">{roleConfig.label}</span>
            <span className="message-index">#{message.index}</span>
            {badge}
          </div>
          <div className="message-meta">
            {message.id && <span className="message-id">{message.id}</span>}
            <span className="scope-path">{message.scopePath}</span>
          </div>
        </header>
        {children}
      </article>
    </div>
  );
};

export const MessageCard = ({
  message,
  showConnector = false,
  renderMarkdown,
}: {
  message: DevtoolsMessageSnapshot;
  showConnector?: boolean;
  renderMarkdown: boolean;
}) => {
  const hasText = Boolean(message.text);
  const hasReasoning = Boolean(message.reasoning);
  const hasToolResults = message.toolResults && message.toolResults.length > 0;

  const body =
    hasText || hasReasoning || hasToolResults ? (
      <div className="message-body">
        {hasText && (
          <MessageContent
            renderMarkdown={renderMarkdown}
            text={message.text ?? ""}
          />
        )}

        {hasReasoning && (
          <CollapsibleSection defaultOpen={false} title="Reasoning">
            <pre className="reasoning-content">{message.reasoning}</pre>
          </CollapsibleSection>
        )}

        {hasToolResults &&
          message.toolResults?.map((result) => {
            const parsedOutput = deepParseJson(result.output);
            return (
              <div className="standalone-tool-result" key={result.toolCallId}>
                <div className="tool-result-label">
                  {result.toolName} result
                </div>
                <JsonViewer value={parsedOutput} />
              </div>
            );
          })}
      </div>
    ) : null;

  return (
    <MessageCardShell message={message} showConnector={showConnector}>
      {body}
    </MessageCardShell>
  );
};

interface ToolInvocationData {
  call: { toolCallId: string; toolName: string; input: unknown };
  result?: { toolCallId: string; toolName: string; output: unknown };
}

const collectInvocations = (turn: MessageTurn): ToolInvocationData[] => {
  const { assistant, toolResults } = turn;

  if (assistant.toolCalls && assistant.toolCalls.length > 0) {
    const resultMap = new Map<
      string,
      { toolCallId: string; toolName: string; output: unknown }
    >();
    for (const toolMsg of toolResults) {
      for (const result of toolMsg.toolResults ?? []) {
        resultMap.set(result.toolCallId, result);
      }
    }
    return assistant.toolCalls.map((call) => ({
      call,
      result: resultMap.get(call.toolCallId),
    }));
  }

  return toolResults.flatMap((toolMsg) =>
    (toolMsg.toolResults ?? []).map((result) => ({
      call: {
        toolCallId: result.toolCallId,
        toolName: result.toolName,
        input: {},
      },
      result,
    }))
  );
};

export const TurnCard = ({
  turn,
  renderMarkdown,
}: {
  turn: MessageTurn;
  renderMarkdown: boolean;
}) => {
  const { assistant } = turn;
  const invocations = collectInvocations(turn);
  const hasInvocations = invocations.length > 0;

  return (
    <div className="timeline-turn">
      <div className="timeline-marker">
        <span className="timeline-dot role-assistant">A</span>
        {hasInvocations && <div className="timeline-line" />}
      </div>
      <div className="turn-content">
        <article className="message-card role-assistant">
          <header className="message-header">
            <div className="message-role">
              <span className="role-label">Assistant</span>
              <span className="message-index">#{assistant.index}</span>
              {hasInvocations && (
                <span className="tool-count">{invocations.length} tool</span>
              )}
            </div>
            <div className="message-meta">
              {assistant.id && (
                <span className="message-id">{assistant.id}</span>
              )}
              <span className="scope-path">{assistant.scopePath}</span>
            </div>
          </header>

          {assistant.text && (
            <div className="message-body">
              <MessageContent
                renderMarkdown={renderMarkdown}
                text={assistant.text}
              />
            </div>
          )}
        </article>

        {hasInvocations && (
          <div className="tool-invocations">
            {invocations.map(({ call, result }) => (
              <ToolInvocation
                call={call}
                key={call.toolCallId}
                result={result}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export const MessageSnapshot = ({
  snapshots,
  renderMarkdown,
}: {
  snapshots: DevtoolsMessageSnapshot[];
  renderMarkdown: boolean;
}) => {
  if (snapshots.length === 0) {
    return <div className="empty">No messages captured.</div>;
  }

  const grouped = groupMessagesIntoTurns(snapshots);

  return (
    <div className="timeline">
      {grouped.map((item) => {
        if (isTurn(item)) {
          return (
            <TurnCard
              key={`turn-${item.assistant.phase}-${item.assistant.index}`}
              renderMarkdown={renderMarkdown}
              turn={item}
            />
          );
        }
        return (
          <MessageCard
            key={`${item.phase}-${item.index}`}
            message={item}
            renderMarkdown={renderMarkdown}
            showConnector={false}
          />
        );
      })}
    </div>
  );
};
