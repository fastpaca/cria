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
import { useCallback, useEffect, useMemo, useState } from "react";

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

const getPulseClass = (isError: boolean, isConnected: boolean): string => {
  if (isError) {
    return "pulse error";
  }
  if (isConnected) {
    return "pulse live";
  }
  return "pulse";
};

const getStatusText = (isError: boolean, isEmpty: boolean): string => {
  if (isError) {
    return "Offline";
  }
  if (isEmpty) {
    return "Waiting for sessions";
  }
  return "Live";
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

const renderSnapshot = (snapshots: DevtoolsMessageSnapshot[]) => {
  if (snapshots.length === 0) {
    return <div className="empty">No messages captured.</div>;
  }

  return (
    <div className="message-list">
      {snapshots.map((message) => (
        <article
          className="message-card"
          key={`${message.phase}-${message.index}`}
        >
          <header className="message-header">
            <strong>
              {message.index}. {message.role}
            </strong>
            <span>{message.scopePath}</span>
          </header>
          <div className="message-body">
            {message.id && <div className="pill">id: {message.id}</div>}
            {message.text && <pre>{message.text}</pre>}
            {message.reasoning && (
              <pre className="muted">reasoning: {message.reasoning}</pre>
            )}
            {message.toolCalls && message.toolCalls.length > 0 && (
              <pre>
                tool calls: {JSON.stringify(message.toolCalls, null, 2)}
              </pre>
            )}
            {message.toolResults && message.toolResults.length > 0 && (
              <pre>
                tool results: {JSON.stringify(message.toolResults, null, 2)}
              </pre>
            )}
          </div>
        </article>
      ))}
    </div>
  );
};

export const App = () => {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [activeTab, setActiveTab] = useState("headers");
  const [payloadPhase, setPayloadPhase] = useState<"before" | "after">(
    "before"
  );

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
      <header className="topbar">
        <div>
          <span className="eyebrow">Cria</span>
          <h1>DevTools</h1>
        </div>
        <div className="status">
          <span
            className={getPulseClass(sessionsQuery.isError, streamConnected)}
          />
          <span>
            {getStatusText(sessionsQuery.isError, sessions.length === 0)}
          </span>
        </div>
      </header>

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

      <main className="network">
        <div className="table">
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
          <section className="details">
            <div className="details-header">
              <div>
                <span className="eyebrow">Session</span>
                <h2>{selected.label ?? selected.id}</h2>
                {selected.error && (
                  <p className="error-banner">{selected.error.message}</p>
                )}
              </div>
              <div className="summary-grid">
                <div>
                  <span>Budget</span>
                  <strong>{selected.budget ?? "-"}</strong>
                </div>
                <div>
                  <span>Tokens</span>
                  <strong>
                    {formatTokens(
                      selected.totalTokensBefore,
                      selected.totalTokensAfter
                    )}
                  </strong>
                </div>
                <div>
                  <span>Iterations</span>
                  <strong>{selected.iterations ?? "-"}</strong>
                </div>
                <div>
                  <span>Duration</span>
                  <strong>{formatDuration(selected.durationMs)}</strong>
                </div>
                <div>
                  <span>Initiator</span>
                  <strong>{resolveInitiator(selected)}</strong>
                </div>
              </div>
            </div>

            <div className="tabs">
              {[
                { key: "headers", label: "Headers" },
                { key: "payload", label: "Payload" },
                { key: "fit", label: "Fit Loop" },
                { key: "timing", label: "Timing" },
                { key: "raw", label: "Raw" },
              ].map((tab) => (
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

            <div className={`panel ${activeTab === "headers" ? "active" : ""}`}>
              <pre>{JSON.stringify(selected, null, 2)}</pre>
            </div>

            <div className={`panel ${activeTab === "payload" ? "active" : ""}`}>
              <div className="payload-toggle">
                <button
                  className={payloadPhase === "before" ? "active" : ""}
                  onClick={() => setPayloadPhase("before")}
                  type="button"
                >
                  Before
                </button>
                <button
                  className={payloadPhase === "after" ? "active" : ""}
                  onClick={() => setPayloadPhase("after")}
                  type="button"
                >
                  After
                </button>
              </div>
              {payloadPhase === "before"
                ? renderSnapshot(selected.snapshots.before)
                : renderSnapshot(selected.snapshots.after)}
            </div>

            <div className={`panel ${activeTab === "fit" ? "active" : ""}`}>
              {selected.strategyEvents.length === 0 ? (
                <div className="empty">No strategy events recorded.</div>
              ) : (
                <div className="message-list">
                  {[...selected.strategyEvents]
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
                            Iteration {event.iteration} · priority{" "}
                            {event.priority}
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
              {selected.timing.length === 0 ? (
                <div className="empty">No timing data.</div>
              ) : (
                <div className="timing-list">
                  {selected.timing.map((event, index) => (
                    <div className="timing-row" key={`${event.name}-${index}`}>
                      <span>{event.name}</span>
                      <span>
                        {formatDuration(
                          event.endOffsetMs - event.startOffsetMs
                        )}{" "}
                        (+
                        {event.startOffsetMs.toFixed(0)}ms)
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className={`panel ${activeTab === "raw" ? "active" : ""}`}>
              <pre>{JSON.stringify(selected, null, 2)}</pre>
            </div>
          </section>
        )}
      </main>
    </div>
  );
};
