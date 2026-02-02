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
              <pre>{JSON.stringify(parsedInput, null, 2)}</pre>
            </div>
          )}
          {parsedOutput && (
            <div className="tool-invocation-section">
              <div className="tool-invocation-label">Output</div>
              <pre>{JSON.stringify(parsedOutput, null, 2)}</pre>
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
}: {
  message: DevtoolsMessageSnapshot;
  showConnector?: boolean;
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
              <div className="message-text">
                <pre>{message.text}</pre>
              </div>
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
                    <pre>{JSON.stringify(parsedOutput, null, 2)}</pre>
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

const TurnCard = ({ turn }: { turn: MessageTurn }) => {
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
              <div className="message-text">
                <pre>{assistant.text}</pre>
              </div>
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
}: {
  snapshots: DevtoolsMessageSnapshot[];
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
              turn={item}
            />
          );
        }
        return (
          <MessageCard
            key={`${item.phase}-${item.index}`}
            message={item}
            showConnector={false}
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

const SessionDetails = ({ session }: { session: DevtoolsSessionPayload }) => {
  const [activeTab, setActiveTab] = useState<string>("payload");
  const [payloadPhase, setPayloadPhase] = useState<"before" | "after">("after");

  return (
    <section className="details">
      <div className="details-header">
        <h2>{session.label ?? session.id}</h2>
        {session.error && (
          <p className="error-banner">{session.error.message}</p>
        )}
      </div>

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

      <div className={`panel ${activeTab === "payload" ? "active" : ""}`}>
        <div className="payload-toggle">
          <button
            className={payloadPhase === "after" ? "active" : ""}
            onClick={() => setPayloadPhase("after")}
            type="button"
          >
            Sent
          </button>
          <button
            className={payloadPhase === "before" ? "active" : ""}
            onClick={() => setPayloadPhase("before")}
            type="button"
          >
            Before Fit
          </button>
        </div>
        <MessageSnapshot
          snapshots={
            payloadPhase === "before"
              ? session.snapshots.before
              : session.snapshots.after
          }
        />
      </div>

      <div className={`panel ${activeTab === "fit" ? "active" : ""}`}>
        {session.strategyEvents.length === 0 ? (
          <div className="empty">No strategy events recorded.</div>
        ) : (
          <div className="message-list">
            {[...session.strategyEvents]
              .sort((a, b) =>
                a.iteration === b.iteration
                  ? a.priority - b.priority
                  : a.iteration - b.iteration
              )
              .map((event, index) => (
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
                  <pre>{JSON.stringify(event.targetScope, null, 2)}</pre>
                </article>
              ))}
          </div>
        )}
      </div>

      <div className={`panel ${activeTab === "timing" ? "active" : ""}`}>
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

      <div className={`panel ${activeTab === "raw" ? "active" : ""}`}>
        <pre>{JSON.stringify(session, null, 2)}</pre>
      </div>
    </section>
  );
};

export const App = () => {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

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

  useSessionStream(handleSession);

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
        <div className="meta">{filtered.length} sessions</div>
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
              <div className="empty">No sessions yet.</div>
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
