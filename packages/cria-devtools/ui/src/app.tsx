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
import fastDiff from "fast-diff";
import {
  type ChangeEvent,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { z } from "zod";

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

interface ResizableOptions {
  initialWidth?: number | null;
  minWidth: number;
  maxWidth?: number;
  maxWidthPercent?: number;
}

const useResizable = <T extends HTMLElement>({
  initialWidth = null,
  minWidth,
  maxWidth,
  maxWidthPercent,
}: ResizableOptions) => {
  const [width, setWidth] = useState<number | null>(initialWidth);
  const [isDragging, setIsDragging] = useState(false);
  const ref = useRef<T | null>(null);

  useEffect(() => {
    if (!isDragging) {
      return;
    }

    const handleMouseMove = (e: MouseEvent) => {
      if (!ref.current) {
        return;
      }
      const rect = ref.current.getBoundingClientRect();
      const resolvedMax =
        maxWidth ??
        (maxWidthPercent ? rect.width * maxWidthPercent : rect.width);
      const newWidth = Math.min(
        Math.max(e.clientX - rect.left, minWidth),
        resolvedMax
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
  }, [isDragging, minWidth, maxWidth, maxWidthPercent]);

  const startDragging = useCallback(() => {
    setIsDragging(true);
    document.body.classList.add("resizing");
  }, []);

  return { width, isDragging, startDragging, ref };
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

const formatDate = (iso: string, includeDate = false): string =>
  new Date(iso)[includeDate ? "toLocaleString" : "toLocaleTimeString"]();

const downloadJson = (value: unknown, filename: string): void => {
  const payload = JSON.stringify(value, null, 2);
  const blob = new Blob([payload], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
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

const buildColumns = (
  onNameResizeStart: (event: ReactMouseEvent<HTMLButtonElement>) => void,
  isResizing: boolean
) =>
  [
    columnHelper.accessor((row) => row.label ?? row.id, {
      id: "name",
      header: () => (
        <div className="col-header">
          <span>Name</span>
          <button
            aria-label="Resize Name column"
            className={`col-resizer ${isResizing ? "dragging" : ""}`}
            onMouseDown={onNameResizeStart}
            type="button"
          />
        </div>
      ),
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
      cell: (info) => formatDate(info.getValue()),
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

const SessionSchema = z
  .object({
    id: z.string(),
    startedAt: z.string(),
    durationMs: z.number(),
    status: z.string(),
  })
  .passthrough();

const SessionsSchema = z.union([
  z.array(SessionSchema).min(1, "No sessions found in file."),
  SessionSchema.transform((s) => [s]),
]);

const parseImportedSessions = (value: unknown): DevtoolsSessionPayload[] => {
  const result = SessionsSchema.safeParse(value);
  if (!result.success) {
    throw new Error(
      result.error.issues[0]?.message ?? "Invalid session format"
    );
  }
  return result.data as DevtoolsSessionPayload[];
};

const mergeSessions = (
  current: DevtoolsSessionPayload[],
  incoming: DevtoolsSessionPayload[]
): DevtoolsSessionPayload[] => {
  const map = new Map<string, DevtoolsSessionPayload>();
  for (const session of incoming) {
    map.set(session.id, session);
  }
  for (const session of current) {
    if (!map.has(session.id)) {
      map.set(session.id, session);
    }
  }
  return [...map.values()];
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

const cx = (...classes: (string | false | null | undefined)[]) =>
  classes.filter(Boolean).join(" ");

interface ToggleOption<T extends string> {
  value: T;
  label: string;
}

const ToggleGroup = <T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly ToggleOption<T>[];
  value: T;
  onChange: (value: T) => void;
}) => (
  <div className="toggle-group">
    {options.map((option) => (
      <button
        className={value === option.value ? "active" : ""}
        key={option.value}
        onClick={() => onChange(option.value)}
        type="button"
      >
        {option.label}
      </button>
    ))}
  </div>
);

const MetaItem = ({
  label,
  value,
  className,
  title,
}: {
  label: string;
  value: ReactNode;
  className?: string;
  title?: string;
}) => (
  <div className="meta-item">
    <div className="meta-label">{label}</div>
    <div className={cx("meta-value", className)} title={title}>
      {value}
    </div>
  </div>
);

const deepParseJson = (obj: unknown): unknown => {
  if (typeof obj === "string") {
    try {
      return JSON.parse(obj);
    } catch {
      return obj;
    }
  }
  if (Array.isArray(obj)) {
    return obj.map(deepParseJson);
  }
  if (obj && typeof obj === "object") {
    return Object.fromEntries(
      Object.entries(obj).map(([k, v]) => [k, deepParseJson(v)])
    );
  }
  return obj;
};

const MAX_TEXT_PREVIEW = 600;
const SESSION_PARAM = "session";
const NAME_COLUMN_MIN_WIDTH = 160;
const NAME_COLUMN_MAX_WIDTH = 900;

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
  if (value === null || value === undefined) {
    return String(value);
  }
  const type = typeof value;
  if (type === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return "unserializable";
    }
  }
  return `${type[0]}:${value}`;
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

const getSessionFromUrl = (): string | null => {
  if (typeof window === "undefined") {
    return null;
  }
  return new URLSearchParams(window.location.search).get(SESSION_PARAM);
};

const MessageTextBlock = ({
  children,
  className,
  contentLength,
}: {
  children: ReactNode;
  className?: string;
  contentLength: number;
}) => {
  const [expanded, setExpanded] = useState(false);
  const isLong = contentLength > MAX_TEXT_PREVIEW;
  const classes = [
    "message-text",
    className,
    isLong && !expanded ? "collapsed" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes}>
      {children}
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

const MessageContent = ({
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

interface DiffOp {
  type: "equal" | "add" | "del";
  text: string;
}

const DIFF_TYPE_MAP = {
  [fastDiff.EQUAL]: "equal",
  [fastDiff.INSERT]: "add",
  [fastDiff.DELETE]: "del",
} as const;

const diffText = (before: string, after: string): DiffOp[] =>
  fastDiff(before, after).map(([type, text]) => ({
    type: DIFF_TYPE_MAP[type],
    text,
  }));

const getMessageContent = (message: DevtoolsMessageSnapshot): string => {
  const sections: string[] = [];
  if (message.text) {
    sections.push(message.text);
  }
  if (message.reasoning) {
    sections.push(`[reasoning]\n${message.reasoning}`);
  }
  if (message.toolCalls && message.toolCalls.length > 0) {
    sections.push(
      `[tool_calls]\n${JSON.stringify(message.toolCalls, null, 2)}`
    );
  }
  if (message.toolResults && message.toolResults.length > 0) {
    sections.push(
      `[tool_results]\n${JSON.stringify(message.toolResults, null, 2)}`
    );
  }
  return sections.join("\n\n");
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
    return null;
  }

  return (
    <pre className="diff-block">
      {ops.map((op, index) => (
        <span className={`diff-${op.type}`} key={`${op.type}-${index}`}>
          {op.text}
        </span>
      ))}
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

const MessageCardShell = ({
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

const MessageCard = ({
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

const DiffMessageContent = ({
  beforeText,
  afterText,
  forceMode,
}: {
  beforeText: string;
  afterText: string;
  forceMode?: "add" | "del";
}) => {
  if (beforeText.length === 0 && afterText.length === 0) {
    return <div className="muted">No content.</div>;
  }

  return (
    <MessageTextBlock
      className="plain"
      contentLength={Math.max(beforeText.length, afterText.length)}
    >
      <InlineDiffBlock
        afterText={afterText}
        beforeText={beforeText}
        forceMode={forceMode}
      />
    </MessageTextBlock>
  );
};

const InlineDiffCard = ({ before, after }: CompareRow) => {
  const message = after ?? before;
  if (!message) {
    return null;
  }

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
      <MessageContent renderMarkdown={false} text={content} />
    ) : (
      <div className="muted">No content.</div>
    );
  } else {
    body = (
      <DiffMessageContent
        afterText={afterText}
        beforeText={beforeText}
        forceMode={diffMode}
      />
    );
  }

  return (
    <MessageCardShell
      badge={<span className={`diff-badge ${status}`}>{status}</span>}
      message={message}
    >
      <div className="message-body">{body}</div>
    </MessageCardShell>
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

const DiffViewSection = ({ session }: { session: DevtoolsSessionPayload }) => {
  const [diffMode, setDiffMode] = useState<DiffViewMode>("inline");
  const [textMode, setTextMode] = useState<TextMode>("text");

  const diffView =
    diffMode === "inline" ? (
      <InlineCompareView
        after={session.snapshots.after}
        before={session.snapshots.before}
      />
    ) : (
      <div className="compare-grid">
        <div className="compare-column">
          <div className="compare-title">Before Fit</div>
          <MessageSnapshot
            renderMarkdown={textMode === "markdown"}
            snapshots={session.snapshots.before}
          />
        </div>
        <div className="compare-column">
          <div className="compare-title">Sent</div>
          <MessageSnapshot
            renderMarkdown={textMode === "markdown"}
            snapshots={session.snapshots.after}
          />
        </div>
      </div>
    );

  return (
    <div className="fit-section">
      <div className="fit-section-header">
        <span>Diff View</span>
        <span className="fit-section-subtitle">Before Fit → Sent</span>
      </div>
      <div className="panel-toolbar">
        <ToggleGroup
          onChange={setDiffMode}
          options={DIFF_MODE_OPTIONS}
          value={diffMode}
        />
        {diffMode === "split" && (
          <ToggleGroup
            onChange={setTextMode}
            options={TEXT_MODE_OPTIONS}
            value={textMode}
          />
        )}
      </div>
      {diffView}
    </div>
  );
};

const DETAIL_TABS = [
  { key: "payload", label: "Payload" },
  { key: "diff", label: "Diff" },
  { key: "raw", label: "Raw" },
] as const;

type PayloadViewMode = "after" | "before";
type RawViewMode = "tree" | "raw";
type DiffViewMode = "inline" | "split";
type TextMode = "text" | "markdown";

const DIFF_MODE_OPTIONS: ToggleOption<DiffViewMode>[] = [
  { value: "inline", label: "Inline diff" },
  { value: "split", label: "Split" },
];

const PAYLOAD_MODE_OPTIONS: ToggleOption<PayloadViewMode>[] = [
  { value: "after", label: "Sent" },
  { value: "before", label: "Before Fit" },
];

const RAW_MODE_OPTIONS: ToggleOption<RawViewMode>[] = [
  { value: "tree", label: "Tree" },
  { value: "raw", label: "Raw" },
];

const TEXT_MODE_OPTIONS: ToggleOption<TextMode>[] = [
  { value: "text", label: "Text" },
  { value: "markdown", label: "Markdown" },
];

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
  const exportPayload = () => {
    downloadJson(
      {
        id: session.id,
        label: session.label,
        startedAt: session.startedAt,
        snapshots: session.snapshots,
      },
      `cria-payload-${session.id}.json`
    );
  };
  const exportSession = () => {
    downloadJson(session, `cria-session-${session.id}.json`);
  };

  return (
    <div className="details-header">
      <div className="details-header-top">
        <h2>{session.label ?? session.id}</h2>
        <div className="details-actions">
          <button
            className="action-button"
            onClick={exportPayload}
            type="button"
          >
            Export payload
          </button>
          <button
            className="action-button"
            onClick={exportSession}
            type="button"
          >
            Export session
          </button>
        </div>
      </div>
      {session.error && <p className="error-banner">{session.error.message}</p>}
      <div className="details-meta">
        <MetaItem
          className={`status-${session.status}`}
          label="Status"
          value={session.status}
        />
        <MetaItem label="Started" value={formatDate(session.startedAt, true)} />
        <MetaItem label="Duration" value={formatDuration(session.durationMs)} />
        <MetaItem label="Budget" value={session.budget ?? "-"} />
        <MetaItem
          label="Tokens"
          value={formatTokens(
            session.totalTokensBefore,
            session.totalTokensAfter
          )}
        />
        <MetaItem
          className={tokenDeltaClass(tokenDelta)}
          label="Delta"
          value={formatTokenDelta(tokenDelta)}
        />
        <MetaItem label="Iterations" value={session.iterations ?? 0} />
        <MetaItem label="Trace" title={traceId} value={traceLabel} />
        <MetaItem
          label="Source"
          title={sourceLabel || undefined}
          value={sourceLabel || "-"}
        />
        <MetaItem
          label="Initiator"
          title={initiatorLabel}
          value={initiatorLabel}
        />
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
  const [textMode, setTextMode] = useState<TextMode>("text");

  return (
    <div className={cx("panel", active && "active")}>
      <div className="panel-toolbar">
        <ToggleGroup
          onChange={setViewMode}
          options={PAYLOAD_MODE_OPTIONS}
          value={viewMode}
        />
        <ToggleGroup
          onChange={setTextMode}
          options={TEXT_MODE_OPTIONS}
          value={textMode}
        />
      </div>
      <MessageSnapshot
        renderMarkdown={textMode === "markdown"}
        snapshots={
          viewMode === "before"
            ? session.snapshots.before
            : session.snapshots.after
        }
      />
    </div>
  );
};

const DiffPanel = ({
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
    <div className={cx("panel", active && "active")}>
      <DiffViewSection session={session} />
      <div className="fit-section">
        <div className="fit-section-header">
          <span>Fit Loop</span>
        </div>
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
    <div className={cx("panel", active && "active")}>
      <div className="panel-toolbar">
        <ToggleGroup
          onChange={setRawMode}
          options={RAW_MODE_OPTIONS}
          value={rawMode}
        />
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
      <DiffPanel active={activeTab === "diff"} session={session} />
      <RawPanel active={activeTab === "raw"} session={session} />
    </section>
  );
};

export const App = () => {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [importError, setImportError] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const traceEndpoint = origin ? `${origin}/v1/traces` : "/v1/traces";

  const {
    width: tableWidth,
    isDragging: isPanelDragging,
    startDragging: startPanelDragging,
    ref: containerRef,
  } = useResizable<HTMLElement>({
    initialWidth: 450,
    minWidth: 300,
    maxWidthPercent: 0.7,
  });
  const {
    width: nameColumnWidth,
    isDragging: isNameResizing,
    startDragging: startNameResize,
    ref: tableRef,
  } = useResizable<HTMLDivElement>({
    minWidth: NAME_COLUMN_MIN_WIDTH,
    maxWidth: NAME_COLUMN_MAX_WIDTH,
  });

  const sessionsQuery = useQuery({
    queryKey: ["sessions"],
    queryFn: fetchSessions,
  });

  const addSessions = useCallback(
    (incoming: DevtoolsSessionPayload[]) => {
      queryClient.setQueryData<DevtoolsSessionPayload[]>(["sessions"], (prev) =>
        mergeSessions(prev ?? [], incoming)
      );
    },
    [queryClient]
  );

  const handleSession = useCallback(
    (session: DevtoolsSessionPayload) => {
      addSessions([session]);
    },
    [addSessions]
  );

  const streamConnected = useSessionStream(handleSession);
  const handleNameResizeStart = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      startNameResize();
    },
    [startNameResize]
  );
  const handleImportClick = useCallback(() => {
    importInputRef.current?.click();
  }, []);
  const handleImportFile = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) {
        return;
      }
      setImportError(null);
      try {
        const text = await file.text();
        const parsed = JSON.parse(text) as unknown;
        const sessions = parseImportedSessions(parsed);
        addSessions(sessions);
      } catch (error) {
        setImportError(
          error instanceof Error ? error.message : "Failed to import sessions."
        );
      } finally {
        event.target.value = "";
      }
    },
    [addSessions]
  );

  const sessions = sessionsQuery.data ?? [];
  const filtered = filterSessions(sessions, query, statusFilter).sort((a, b) =>
    a.startedAt < b.startedAt ? 1 : -1
  );

  const columns = useMemo(
    () => buildColumns(handleNameResizeStart, isNameResizing),
    [handleNameResizeStart, isNameResizing]
  );
  const table = useReactTable({
    data: filtered,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  const selected =
    sessions.find((session) => session.id === selectedId) ?? null;
  const tableStyle = useMemo(
    () => ({
      ...(selected ? { width: tableWidth } : {}),
      ...(nameColumnWidth !== null
        ? { "--col-name": `${nameColumnWidth}px` }
        : {}),
    }),
    [nameColumnWidth, selected, tableWidth]
  );

  useEffect(() => {
    if (selectedId) {
      return;
    }
    const initialId = getSessionFromUrl();
    if (initialId) {
      setSelectedId(initialId);
    }
  }, [selectedId]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const url = new URL(window.location.href);
    if (selectedId) {
      url.searchParams.set(SESSION_PARAM, selectedId);
    } else {
      url.searchParams.delete(SESSION_PARAM);
    }
    window.history.replaceState(null, "", url.toString());
  }, [selectedId]);

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
          <button
            className="action-button"
            onClick={handleImportClick}
            type="button"
          >
            Import
          </button>
          {importError && <div className="import-error">{importError}</div>}
        </div>
      </section>
      <input
        accept="application/json"
        aria-hidden="true"
        className="import-input"
        onChange={handleImportFile}
        ref={importInputRef}
        tabIndex={-1}
        type="file"
      />

      <main
        className={`network ${selected ? "has-selection" : ""}`}
        ref={containerRef as React.RefObject<HTMLElement>}
      >
        <div
          className="table"
          ref={tableRef}
          style={tableStyle as CSSProperties}
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
                  <div className="empty-steps">
                    <span>1. Start DevTools and refresh this page.</span>
                    <span>
                      2. Add createOtelRenderHooks to your render call.
                    </span>
                    <span>3. Render a prompt with a budget.</span>
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
              className={`resize-handle ${isPanelDragging ? "dragging" : ""}`}
              onMouseDown={startPanelDragging}
            />
            <SessionDetails session={selected} />
          </>
        )}
      </main>
    </div>
  );
};
