import type {
  DevtoolsMessageSnapshot,
  DevtoolsSessionPayload,
} from "@shared/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const fetchSessions = async (): Promise<DevtoolsSessionPayload[]> => {
  const response = await fetch("/cria/devtools/sessions");
  if (!response.ok) {
    throw new Error("Failed to fetch sessions");
  }
  return response.json() as Promise<DevtoolsSessionPayload[]>;
};

const useSessionStream = (
  onSession: (session: DevtoolsSessionPayload) => void
): boolean => {
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const stream = new EventSource("/cria/devtools/stream");
    stream.addEventListener("session", (event) => {
      try {
        const data = JSON.parse(
          (event as MessageEvent<string>).data
        ) as DevtoolsSessionPayload;
        onSession(data);
      } catch {
        // ignore malformed events
      }
    });
    stream.onopen = () => setConnected(true);
    stream.onerror = () => setConnected(false);
    return () => stream.close();
  }, [onSession]);

  return connected;
};

const useResizablePanel = (
  initialWidth: number,
  minWidth: number,
  maxWidthPercent: number
) => {
  const [width, setWidth] = useState(initialWidth);
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isDragging) {
      return;
    }

    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) {
        return;
      }
      const containerRect = containerRef.current.getBoundingClientRect();
      const maxWidth = containerRect.width * maxWidthPercent;
      const newWidth = Math.min(
        Math.max(e.clientX - containerRect.left, minWidth),
        maxWidth
      );
      setWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      document.body.classList.remove("resizing");
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging, minWidth, maxWidthPercent]);

  const startDragging = useCallback(() => {
    setIsDragging(true);
    document.body.classList.add("resizing");
  }, []);

  return { width, isDragging, startDragging, containerRef };
};

const formatDuration = (ms?: number): string => {
  if (!ms && ms !== 0) {
    return "-";
  }
  if (ms < 1000) {
    return `${ms.toFixed(0)}ms`;
  }
  return `${(ms / 1000).toFixed(2)}s`;
};

const formatTokens = (before?: number, after?: number): string => {
  if (before === undefined) {
    return "-";
  }
  if (after === undefined || after === before) {
    return `${before}`;
  }
  return `${before} → ${after}`;
};

const formatTime = (iso: string): string => {
  const date = new Date(iso);
  return date.toLocaleTimeString();
};

const formatDateTime = (iso: string): string => {
  const date = new Date(iso);
  return date.toLocaleString();
};

const resolveInitiator = (session: DevtoolsSessionPayload): string => {
  const initiator = session.initiator?.name;
  if (initiator) {
    return initiator;
  }
  const traceId = session.trace?.traceId;
  if (traceId) {
    return `trace ${traceId.slice(0, 8)}`;
  }
  return "-";
};

const columnHelper = createColumnHelper<DevtoolsSessionPayload>();

const buildColumns = () =>
  [
    columnHelper.accessor((row) => row.label ?? row.id, {
      id: "name",
      header: "Name",
      cell: (info) => info.getValue(),
    }),
    columnHelper.accessor((row) => row.status, {
      id: "status",
      header: "Status",
      cell: (info) => (
        <span className={`badge ${info.getValue()}`}>{info.getValue()}</span>
      ),
    }),
    columnHelper.accessor((row) => row.budget, {
      id: "budget",
      header: "Budget",
      cell: (info) => info.getValue() ?? "-",
    }),
    columnHelper.accessor((row) => row, {
      id: "tokens",
      header: "Tokens",
      cell: (info) =>
        formatTokens(
          info.getValue().totalTokensBefore,
          info.getValue().totalTokensAfter
        ),
    }),
    columnHelper.accessor((row) => row.durationMs, {
      id: "duration",
      header: "Duration",
      cell: (info) => formatDuration(info.getValue()),
    }),
    columnHelper.accessor((row) => row.startedAt, {
      id: "started",
      header: "Started",
      cell: (info) => formatTime(info.getValue()),
    }),
    columnHelper.accessor((row) => row, {
      id: "initiator",
      header: "Initiator",
      cell: (info) => resolveInitiator(info.getValue()),
    }),
  ] as const;

const filterSessions = (
  sessions: DevtoolsSessionPayload[],
  query: string,
  statusFilter: string
): DevtoolsSessionPayload[] => {
  const normalized = query.trim().toLowerCase();
  let filtered = sessions;

  if (statusFilter !== "all") {
    filtered = filtered.filter((session) => session.status === statusFilter);
  }

  if (normalized.length > 0) {
    filtered = filtered.filter((session) => {
      const haystack = [
        session.id,
        session.label,
        session.trace?.traceId,
        session.initiator?.name,
        session.snapshots.before.map((msg) => msg.id ?? "").join(" "),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(normalized);
    });
  }

  return filtered;
};

const ROLE_CONFIG: Record<
  string,
  { icon: string; label: string; className: string }
> = {
  system: { icon: "S", label: "System", className: "role-system" },
  user: { icon: "U", label: "User", className: "role-user" },
  assistant: { icon: "A", label: "Assistant", className: "role-assistant" },
  tool: { icon: "T", label: "Tool", className: "role-tool" },
};

interface MessageTurn {
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

const groupMessagesIntoTurns = (
  messages: DevtoolsMessageSnapshot[]
): Array<DevtoolsMessageSnapshot | MessageTurn> => {
  const result: Array<DevtoolsMessageSnapshot | MessageTurn> = [];
  let i = 0;

  while (i < messages.length) {
    const msg = messages[i];

    // Case 1: Assistant with explicit toolCalls
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
    }
    // Case 2: Empty assistant followed by tool message (implicit tool call)
    else if (
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

const isTurn = (
  item: DevtoolsMessageSnapshot | MessageTurn
): item is MessageTurn => {
  return "assistant" in item && "toolResults" in item;
};

const tryParseJson = (value: unknown): unknown => {
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
};

const deepParseJson = (obj: unknown): unknown => {
  if (typeof obj === "string") {
    return tryParseJson(obj);
  }
  if (Array.isArray(obj)) {
    return obj.map(deepParseJson);
  }
  if (obj && typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = deepParseJson(value);
    }
    return result;
  }
  return obj;
};

const MAX_TEXT_PREVIEW = 600;
const DIFF_TOKEN_REGEX = /(\s+)/;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const formatPrimitive = (value: unknown): string => {
  if (value === null) {
    return "null";
  }
  if (value === undefined) {
    return "undefined";
  }
  if (typeof value === "string") {
    return `"${value}"`;
  }
  return String(value);
};

const primitiveClass = (value: unknown): string => {
  if (value === null) {
    return "json-null";
  }
  if (value === undefined) {
    return "json-undefined";
  }
  return `json-${typeof value}`;
};

const stableKeyForValue = (value: unknown): string => {
  if (value === null) {
    return "null";
  }
  if (value === undefined) {
    return "undefined";
  }
  if (typeof value === "string") {
    return `s:${value}`;
  }
  if (typeof value === "number") {
    return `n:${value}`;
  }
  if (typeof value === "boolean") {
    return `b:${value}`;
  }
  try {
    return `j:${JSON.stringify(value)}`;
  } catch {
    return "j:unserializable";
  }
};

const JsonTree = ({
  value,
  depth = 0,
}: {
  value: unknown;
  depth?: number;
}): ReactNode => {
  if (Array.isArray(value)) {
    const keyCounts = new Map<string, number>();
    return (
      <div className="json-tree">
        {value.map((item, index) => {
          const baseKey = stableKeyForValue(item);
          const seen = keyCounts.get(baseKey) ?? 0;
          keyCounts.set(baseKey, seen + 1);
          const label = `[${index}]`;
          return (
            <JsonNode
              depth={depth}
              key={`${baseKey}-${seen}`}
              label={label}
              value={item}
            />
          );
        })}
      </div>
    );
  }

  if (isPlainObject(value)) {
    return (
      <div className="json-tree">
        {Object.entries(value).map(([key, item]) => (
          <JsonNode
            depth={depth}
            key={`${depth}-${key}`}
            label={key}
            value={item}
          />
        ))}
      </div>
    );
  }

  return (
    <span className={`json-primitive ${primitiveClass(value)}`}>
      {formatPrimitive(value)}
    </span>
  );
};

const JsonNode = ({
  label,
  value,
  depth,
}: {
  label: string;
  value: unknown;
  depth: number;
}) => {
  const isComplex = Array.isArray(value) || isPlainObject(value);

  if (!isComplex) {
    return (
      <div className="json-row">
        <span className="json-key">{label}</span>
        <span className="json-separator">:</span>
        <span className={`json-primitive ${primitiveClass(value)}`}>
          {formatPrimitive(value)}
        </span>
      </div>
    );
  }

  const childCount = Array.isArray(value)
    ? value.length
    : Object.keys(value).length;
  const preview = Array.isArray(value)
    ? `Array(${childCount})`
    : `Object(${childCount})`;

  return (
    <details className="json-node" open={depth < 1}>
      <summary>
        <span className="json-key">{label}</span>
        <span className="json-separator">:</span>
        <span className="json-preview">{preview}</span>
      </summary>
      <div className="json-children">
        <JsonTree depth={depth + 1} value={value} />
      </div>
    </details>
  );
};

const renderJsonValue = (value: unknown): ReactNode => {
  if (typeof value === "string") {
    const isMultiline = value.includes("\n") || value.length > 120;
    if (isMultiline) {
      return <pre className="json-pre">{value}</pre>;
    }
  }

  return <JsonTree value={value} />;
};

const JsonViewer = ({ value }: { value: unknown }) => {
  return <div className="json-viewer">{renderJsonValue(value)}</div>;
};

const MessageContent = ({
  text,
  renderMarkdown,
}: {
  text: string;
  renderMarkdown: boolean;
}) => {
  const [expanded, setExpanded] = useState(false);
  const isLong = text.length > MAX_TEXT_PREVIEW;

  return (
    <div
      className={`message-text ${renderMarkdown ? "markdown" : "plain"} ${
        isLong && !expanded ? "collapsed" : ""
      }`}
    >
      {renderMarkdown ? (
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
      ) : (
        <pre>{text}</pre>
      )}
      {isLong && (
        <button
          className="text-toggle"
          onClick={() => setExpanded(!expanded)}
          type="button"
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
};

interface DiffOp {
  type: "equal" | "add" | "del";
  text: string;
}

const MAX_DIFF_MATRIX = 120_000;

const tokenizeDiffText = (text: string): string[] =>
  text.length === 0 ? [] : text.split(DIFF_TOKEN_REGEX);

const mergeDiffOps = (ops: DiffOp[]): DiffOp[] => {
  const merged: DiffOp[] = [];
  for (const op of ops) {
    const last = merged.at(-1);
    if (last && last.type === op.type) {
      last.text += op.text;
      continue;
    }
    merged.push({ ...op });
  }
  return merged;
};

const diffTokenArrays = (before: string[], after: string[]): DiffOp[] => {
  if (before.length === 0 && after.length === 0) {
    return [];
  }
  if (before.length === 0) {
    return after.map((token) => ({ type: "add", text: token }));
  }
  if (after.length === 0) {
    return before.map((token) => ({ type: "del", text: token }));
  }

  const cellCount = before.length * after.length;
  if (cellCount > MAX_DIFF_MATRIX) {
    return [
      { type: "del", text: before.join("") },
      { type: "add", text: after.join("") },
    ];
  }

  const dp = Array.from({ length: before.length + 1 }, () =>
    new Array(after.length + 1).fill(0)
  );

  for (let i = before.length - 1; i >= 0; i -= 1) {
    for (let j = after.length - 1; j >= 0; j -= 1) {
      if (before[i] === after[j]) {
        dp[i][j] = dp[i + 1][j + 1] + 1;
        continue;
      }
      dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < before.length && j < after.length) {
    if (before[i] === after[j]) {
      ops.push({ type: "equal", text: before[i] });
      i += 1;
      j += 1;
      continue;
    }
    if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ type: "del", text: before[i] });
      i += 1;
      continue;
    }
    ops.push({ type: "add", text: after[j] });
    j += 1;
  }
  for (; i < before.length; i += 1) {
    ops.push({ type: "del", text: before[i] });
  }
  for (; j < after.length; j += 1) {
    ops.push({ type: "add", text: after[j] });
  }

  return mergeDiffOps(ops);
};

const diffText = (before: string, after: string): DiffOp[] => {
  const beforeTokens = tokenizeDiffText(before);
  const afterTokens = tokenizeDiffText(after);
  return diffTokenArrays(beforeTokens, afterTokens);
};

const hashString = (value: string): string => {
  let hash = 5381;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 33 + value.charCodeAt(i)) % 4_294_967_291;
  }
  return hash.toString(36);
};

const getMessageContent = (message: DevtoolsMessageSnapshot): string => {
  if (message.text) {
    return message.text;
  }
  if (message.reasoning) {
    return message.reasoning;
  }
  if (message.toolResults && message.toolResults.length > 0) {
    return JSON.stringify(message.toolResults, null, 2);
  }
  if (message.toolCalls && message.toolCalls.length > 0) {
    return JSON.stringify(message.toolCalls, null, 2);
  }
  return "";
};

const InlineDiffBlock = ({
  beforeText,
  afterText,
  forceMode,
}: {
  beforeText: string;
  afterText: string;
  forceMode?: "add" | "del";
}) => {
  const ops = useMemo(() => {
    if (forceMode === "add") {
      return [{ type: "add", text: afterText }] as DiffOp[];
    }
    if (forceMode === "del") {
      return [{ type: "del", text: beforeText }] as DiffOp[];
    }
    return diffText(beforeText, afterText);
  }, [afterText, beforeText, forceMode]);

  if (ops.length === 0) {
    return <div className="muted">No content.</div>;
  }

  const keyCounts = new Map<string, number>();

  return (
    <pre className="diff-block">
      {ops.map((op) => {
        const baseKey = `${op.type}-${hashString(op.text)}`;
        const seen = keyCounts.get(baseKey) ?? 0;
        keyCounts.set(baseKey, seen + 1);
        return (
          <span className={`diff-${op.type}`} key={`${baseKey}-${seen}`}>
            {op.text}
          </span>
        );
      })}
    </pre>
  );
};

const CollapsibleSection = ({
  title,
  badge,
  defaultOpen = false,
  children,
}: {
  title: string;
  badge?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className={`collapsible ${isOpen ? "open" : ""}`}>
      <button
        className="collapsible-header"
        onClick={() => setIsOpen(!isOpen)}
        type="button"
      >
        <span className="collapsible-icon">{isOpen ? "▼" : "▶"}</span>
        <span className="collapsible-title">{title}</span>
        {badge && <span className="collapsible-badge">{badge}</span>}
      </button>
      {isOpen && <div className="collapsible-content">{children}</div>}
    </div>
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

const MessageCard = ({
  message,
  showConnector = false,
  renderMarkdown,
}: {
  message: DevtoolsMessageSnapshot;
  showConnector?: boolean;
  renderMarkdown: boolean;
}) => {
  const roleConfig = ROLE_CONFIG[message.role] ?? {
    icon: "?",
    label: message.role,
    className: "role-unknown",
  };

  const hasText = Boolean(message.text);
  const hasReasoning = Boolean(message.reasoning);
  const hasToolResults = message.toolResults && message.toolResults.length > 0;

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
          </div>
          <div className="message-meta">
            {message.id && <span className="message-id">{message.id}</span>}
            <span className="scope-path">{message.scopePath}</span>
          </div>
        </header>

        {(hasText || hasReasoning || hasToolResults) && (
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
                  <div
                    className="standalone-tool-result"
                    key={result.toolCallId}
                  >
                    <div className="tool-result-label">
                      {result.toolName} result
                    </div>
                    <JsonViewer value={parsedOutput} />
                  </div>
                );
              })}
          </div>
        )}
      </article>
    </div>
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

const TurnCard = ({
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

const MessageSnapshot = ({
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

interface CompareRow {
  before?: DevtoolsMessageSnapshot;
  after?: DevtoolsMessageSnapshot;
}

const buildCompareRows = (
  before: DevtoolsMessageSnapshot[],
  after: DevtoolsMessageSnapshot[]
): CompareRow[] => {
  const beforeMap = new Map<number, DevtoolsMessageSnapshot>();
  for (const message of before) {
    beforeMap.set(message.index, message);
  }
  const afterMap = new Map<number, DevtoolsMessageSnapshot>();
  for (const message of after) {
    afterMap.set(message.index, message);
  }

  const indices = new Set<number>([...beforeMap.keys(), ...afterMap.keys()]);

  return [...indices]
    .sort((a, b) => a - b)
    .map((index) => ({
      before: beforeMap.get(index),
      after: afterMap.get(index),
    }));
};

const resolveDiffStatus = (
  beforeText: string,
  afterText: string,
  hasBefore: boolean,
  hasAfter: boolean
): "added" | "removed" | "unchanged" | "changed" => {
  if (!hasBefore && hasAfter) {
    return "added";
  }
  if (hasBefore && !hasAfter) {
    return "removed";
  }
  if (beforeText === afterText) {
    return "unchanged";
  }
  if (beforeText.length === 0 && afterText.length === 0) {
    return "unchanged";
  }
  return "changed";
};

const InlineDiffCard = ({ before, after }: CompareRow) => {
  const message = after ?? before;
  if (!message) {
    return null;
  }

  const roleConfig = ROLE_CONFIG[message.role] ?? {
    icon: "?",
    label: message.role,
    className: "role-unknown",
  };

  const beforeText = before ? getMessageContent(before) : "";
  const afterText = after ? getMessageContent(after) : "";
  const hasBefore = Boolean(before);
  const hasAfter = Boolean(after);
  const status = resolveDiffStatus(beforeText, afterText, hasBefore, hasAfter);
  const content = status === "unchanged" ? afterText || beforeText : "";
  let diffMode: "add" | "del" | undefined;
  if (status === "added") {
    diffMode = "add";
  } else if (status === "removed") {
    diffMode = "del";
  }

  let body: ReactNode;
  if (status === "unchanged") {
    body = content ? (
      <pre>{content}</pre>
    ) : (
      <div className="muted">No content.</div>
    );
  } else {
    body = (
      <InlineDiffBlock
        afterText={afterText}
        beforeText={beforeText}
        forceMode={diffMode}
      />
    );
  }

  return (
    <div className="timeline-item">
      <div className="timeline-marker">
        <span className={`timeline-dot ${roleConfig.className}`}>
          {roleConfig.icon}
        </span>
      </div>
      <article className={`message-card ${roleConfig.className}`}>
        <header className="message-header">
          <div className="message-role">
            <span className="role-label">{roleConfig.label}</span>
            <span className="message-index">#{message.index}</span>
            <span className={`diff-badge ${status}`}>{status}</span>
          </div>
          <div className="message-meta">
            {message.id && <span className="message-id">{message.id}</span>}
            <span className="scope-path">{message.scopePath}</span>
          </div>
        </header>
        <div className="message-body">{body}</div>
      </article>
    </div>
  );
};

const InlineCompareView = ({
  before,
  after,
}: {
  before: DevtoolsMessageSnapshot[];
  after: DevtoolsMessageSnapshot[];
}) => {
  const rows = useMemo(() => buildCompareRows(before, after), [after, before]);

  return (
    <div className="timeline">
      {rows.map((row) => {
        const message = row.after ?? row.before;
        if (!message) {
          return null;
        }
        return (
          <InlineDiffCard
            after={row.after}
            before={row.before}
            key={`${message.role}-${message.index}`}
          />
        );
      })}
    </div>
  );
};

const DETAIL_TABS = [
  { key: "payload", label: "Payload" },
  { key: "fit", label: "Fit Loop" },
  { key: "timing", label: "Timing" },
  { key: "raw", label: "Raw" },
] as const;

type PayloadViewMode = "after" | "before" | "compare";
type RawViewMode = "tree" | "raw";

const tokenDeltaClass = (delta: number | undefined): string => {
  if (delta === undefined) {
    return "muted";
  }
  if (delta > 0) {
    return "delta-up";
  }
  if (delta < 0) {
    return "delta-down";
  }
  return "";
};

const formatTokenDelta = (delta: number | undefined): string => {
  if (delta === undefined) {
    return "-";
  }
  return `${delta > 0 ? "+" : ""}${delta}`;
};

const SessionHeader = ({ session }: { session: DevtoolsSessionPayload }) => {
  const tokenDelta =
    session.totalTokensBefore !== undefined &&
    session.totalTokensAfter !== undefined
      ? session.totalTokensAfter - session.totalTokensBefore
      : undefined;
  const traceId = session.trace?.traceId;
  const traceLabel = traceId ? traceId.slice(0, 12) : "-";
  const sourceLabel = [
    session.source?.serviceName,
    session.source?.serviceInstanceId,
  ]
    .filter(Boolean)
    .join(" · ");
  const initiatorLabel = resolveInitiator(session);

  return (
    <div className="details-header">
      <h2>{session.label ?? session.id}</h2>
      {session.error && <p className="error-banner">{session.error.message}</p>}
      <div className="details-meta">
        <div className="meta-item">
          <div className="meta-label">Status</div>
          <div className={`meta-value status-${session.status}`}>
            {session.status}
          </div>
        </div>
        <div className="meta-item">
          <div className="meta-label">Started</div>
          <div className="meta-value">{formatDateTime(session.startedAt)}</div>
        </div>
        <div className="meta-item">
          <div className="meta-label">Duration</div>
          <div className="meta-value">{formatDuration(session.durationMs)}</div>
        </div>
        <div className="meta-item">
          <div className="meta-label">Budget</div>
          <div className="meta-value">{session.budget ?? "-"}</div>
        </div>
        <div className="meta-item">
          <div className="meta-label">Tokens</div>
          <div className="meta-value">
            {formatTokens(session.totalTokensBefore, session.totalTokensAfter)}
          </div>
        </div>
        <div className="meta-item">
          <div className="meta-label">Delta</div>
          <div className={`meta-value ${tokenDeltaClass(tokenDelta)}`}>
            {formatTokenDelta(tokenDelta)}
          </div>
        </div>
        <div className="meta-item">
          <div className="meta-label">Iterations</div>
          <div className="meta-value">{session.iterations ?? 0}</div>
        </div>
        <div className="meta-item">
          <div className="meta-label">Trace</div>
          <div className="meta-value" title={traceId ?? undefined}>
            {traceLabel}
          </div>
        </div>
        <div className="meta-item">
          <div className="meta-label">Source</div>
          <div className="meta-value" title={sourceLabel || undefined}>
            {sourceLabel || "-"}
          </div>
        </div>
        <div className="meta-item">
          <div className="meta-label">Initiator</div>
          <div className="meta-value" title={initiatorLabel}>
            {initiatorLabel}
          </div>
        </div>
      </div>
    </div>
  );
};

const PayloadPanel = ({
  session,
  active,
}: {
  session: DevtoolsSessionPayload;
  active: boolean;
}) => {
  const [viewMode, setViewMode] = useState<PayloadViewMode>("after");
  const [compareMode, setCompareMode] = useState<"split" | "inline">("inline");
  const [renderMarkdown, setRenderMarkdown] = useState(false);
  const showMarkdownToggle = viewMode !== "compare" || compareMode === "split";
  const markdownEnabled = showMarkdownToggle ? renderMarkdown : false;
  const compareView =
    compareMode === "inline" ? (
      <InlineCompareView
        after={session.snapshots.after}
        before={session.snapshots.before}
      />
    ) : (
      <div className="compare-grid">
        <div className="compare-column">
          <div className="compare-title">Before Fit</div>
          <MessageSnapshot
            renderMarkdown={markdownEnabled}
            snapshots={session.snapshots.before}
          />
        </div>
        <div className="compare-column">
          <div className="compare-title">Sent</div>
          <MessageSnapshot
            renderMarkdown={markdownEnabled}
            snapshots={session.snapshots.after}
          />
        </div>
      </div>
    );

  return (
    <div className={`panel ${active ? "active" : ""}`}>
      <div className="panel-toolbar">
        <div className="toggle-group">
          <button
            className={viewMode === "after" ? "active" : ""}
            onClick={() => setViewMode("after")}
            type="button"
          >
            Sent
          </button>
          <button
            className={viewMode === "before" ? "active" : ""}
            onClick={() => setViewMode("before")}
            type="button"
          >
            Before Fit
          </button>
          <button
            className={viewMode === "compare" ? "active" : ""}
            onClick={() => setViewMode("compare")}
            type="button"
          >
            Compare
          </button>
        </div>
        {viewMode === "compare" && (
          <div className="toggle-group">
            <button
              className={compareMode === "inline" ? "active" : ""}
              onClick={() => setCompareMode("inline")}
              type="button"
            >
              Inline diff
            </button>
            <button
              className={compareMode === "split" ? "active" : ""}
              onClick={() => setCompareMode("split")}
              type="button"
            >
              Split
            </button>
          </div>
        )}
        {showMarkdownToggle && (
          <div className="toggle-group">
            <button
              className={renderMarkdown ? "" : "active"}
              onClick={() => setRenderMarkdown(false)}
              type="button"
            >
              Text
            </button>
            <button
              className={renderMarkdown ? "active" : ""}
              onClick={() => setRenderMarkdown(true)}
              type="button"
            >
              Markdown
            </button>
          </div>
        )}
      </div>
      {viewMode === "compare" ? (
        compareView
      ) : (
        <MessageSnapshot
          renderMarkdown={markdownEnabled}
          snapshots={
            viewMode === "before"
              ? session.snapshots.before
              : session.snapshots.after
          }
        />
      )}
    </div>
  );
};

const FitPanel = ({
  session,
  active,
}: {
  session: DevtoolsSessionPayload;
  active: boolean;
}) => {
  const hasIterations = Boolean(session.iterations && session.iterations > 0);
  const events = [...session.strategyEvents].sort((a, b) =>
    a.iteration === b.iteration
      ? a.priority - b.priority
      : a.iteration - b.iteration
  );

  return (
    <div className={`panel ${active ? "active" : ""}`}>
      {events.length === 0 ? (
        <div className="empty">
          {hasIterations
            ? "No strategy events recorded."
            : "Fit loop did not run (under budget or disabled)."}
        </div>
      ) : (
        <div className="message-list">
          {events.map((event, index) => (
            <article
              className="message-card"
              key={`${event.iteration}-${index}`}
            >
              <header className="message-header">
                <strong>
                  Iteration {event.iteration} · priority {event.priority}
                </strong>
                <span>{event.result}</span>
              </header>
              <JsonViewer value={event.targetScope} />
            </article>
          ))}
        </div>
      )}
    </div>
  );
};

const TimingPanel = ({
  session,
  active,
}: {
  session: DevtoolsSessionPayload;
  active: boolean;
}) => {
  return (
    <div className={`panel ${active ? "active" : ""}`}>
      {session.timing.length === 0 ? (
        <div className="empty">No timing data.</div>
      ) : (
        <div className="timing-list">
          {session.timing.map((event, index) => (
            <div className="timing-row" key={`${event.name}-${index}`}>
              <span>{event.name}</span>
              <span>
                {formatDuration(event.endOffsetMs - event.startOffsetMs)} (+
                {event.startOffsetMs.toFixed(0)}ms)
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const RawPanel = ({
  session,
  active,
}: {
  session: DevtoolsSessionPayload;
  active: boolean;
}) => {
  const [rawMode, setRawMode] = useState<RawViewMode>("tree");

  return (
    <div className={`panel ${active ? "active" : ""}`}>
      <div className="panel-toolbar">
        <div className="toggle-group">
          <button
            className={rawMode === "tree" ? "active" : ""}
            onClick={() => setRawMode("tree")}
            type="button"
          >
            Tree
          </button>
          <button
            className={rawMode === "raw" ? "active" : ""}
            onClick={() => setRawMode("raw")}
            type="button"
          >
            Raw
          </button>
        </div>
      </div>
      {rawMode === "tree" ? (
        <JsonViewer value={session} />
      ) : (
        <pre className="raw-pre">{JSON.stringify(session, null, 2)}</pre>
      )}
    </div>
  );
};

const SessionDetails = ({ session }: { session: DevtoolsSessionPayload }) => {
  const [activeTab, setActiveTab] = useState<string>("payload");

  return (
    <section className="details">
      <SessionHeader session={session} />

      <div className="tabs">
        {DETAIL_TABS.map((tab) => (
          <button
            className={`tab ${activeTab === tab.key ? "active" : ""}`}
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            type="button"
          >
            {tab.label}
          </button>
        ))}
      </div>

      <PayloadPanel active={activeTab === "payload"} session={session} />
      <FitPanel active={activeTab === "fit"} session={session} />
      <TimingPanel active={activeTab === "timing"} session={session} />
      <RawPanel active={activeTab === "raw"} session={session} />
    </section>
  );
};

export const App = () => {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const traceEndpoint = origin ? `${origin}/v1/traces` : "/v1/traces";

  const {
    width: tableWidth,
    isDragging,
    startDragging,
    containerRef,
  } = useResizablePanel(450, 300, 0.7);

  const sessionsQuery = useQuery({
    queryKey: ["sessions"],
    queryFn: fetchSessions,
  });

  const handleSession = useCallback(
    (session: DevtoolsSessionPayload) => {
      queryClient.setQueryData<DevtoolsSessionPayload[]>(
        ["sessions"],
        (prev) => {
          const current = prev ?? [];
          const next = [
            session,
            ...current.filter((item) => item.id !== session.id),
          ];
          return next;
        }
      );
    },
    [queryClient]
  );

  const streamConnected = useSessionStream(handleSession);

  const sessions = sessionsQuery.data ?? [];
  const filtered = filterSessions(sessions, query, statusFilter).sort((a, b) =>
    a.startedAt < b.startedAt ? 1 : -1
  );

  const columns = useMemo(() => buildColumns(), []);
  const table = useReactTable({
    data: filtered,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  const selected =
    sessions.find((session) => session.id === selectedId) ?? null;

  return (
    <div className="app">
      <section className="toolbar">
        <div className="brand">
          <div className="brand-title">Cria DevTools</div>
          <div
            className={`connection ${streamConnected ? "live" : "offline"}`}
            title={streamConnected ? "Connected to stream" : "Stream offline"}
          >
            <span className="status-dot" />
            {streamConnected ? "Live" : "Offline"}
          </div>
        </div>
        <div className="toolbar-controls">
          <input
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search sessions, ids, traces"
            type="search"
            value={query}
          />
          <div className="chips">
            {[
              { key: "all", label: "All" },
              { key: "success", label: "Ok" },
              { key: "error", label: "Error" },
            ].map((chip) => (
              <button
                className={`chip ${statusFilter === chip.key ? "active" : ""}`}
                key={chip.key}
                onClick={() => setStatusFilter(chip.key)}
                type="button"
              >
                {chip.label}
              </button>
            ))}
          </div>
        </div>
        <div className="toolbar-meta">
          <div className="endpoint" title={traceEndpoint}>
            OTLP {traceEndpoint}
          </div>
          <div className="meta">{filtered.length} sessions</div>
        </div>
      </section>

      <main
        className={`network ${selected ? "has-selection" : ""}`}
        ref={containerRef as React.RefObject<HTMLElement>}
      >
        <div
          className="table"
          style={selected ? { width: tableWidth } : undefined}
        >
          <div className="thead">
            {table.getHeaderGroups().map((headerGroup) => (
              <div className="row" key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <div className={`cell col-${header.id}`} key={header.id}>
                    {flexRender(
                      header.column.columnDef.header,
                      header.getContext()
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>
          <div className="tbody">
            {table.getRowModel().rows.map((row) => (
              <button
                className={`row ${selectedId === row.original.id ? "selected" : ""}`}
                key={row.id}
                onClick={() => setSelectedId(row.original.id)}
                type="button"
              >
                {row.getVisibleCells().map((cell) => (
                  <div className={`cell col-${cell.column.id}`} key={cell.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </div>
                ))}
              </button>
            ))}
            {table.getRowModel().rows.length === 0 && (
              <div className="empty">
                <div className="empty-stack">
                  <div>No sessions yet.</div>
                  <div className="empty-hint">
                    Send OTLP traces to {traceEndpoint}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {selected && (
          <>
            {/* biome-ignore lint/a11y/noStaticElementInteractions: resize handles are standard UI patterns */}
            {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: resize handles are standard UI patterns */}
            <div
              className={`resize-handle ${isDragging ? "dragging" : ""}`}
              onMouseDown={startDragging}
            />
            <SessionDetails session={selected} />
          </>
        )}
      </main>
    </div>
  );
};
