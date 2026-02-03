import type { DevtoolsSessionPayload } from "@shared/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import {
  type ChangeEvent,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { z } from "zod";
import { SessionDetails } from "./components/session";
import { useResizable } from "./hooks/use-resizable";
import { useSessionStream } from "./hooks/use-session-stream";
import { formatDate, formatDuration, formatTokens } from "./utils/format";

const SESSION_PARAM = "session";
const NAME_COLUMN_MIN_WIDTH = 160;
const NAME_COLUMN_MAX_WIDTH = 900;

const fetchSessions = async (): Promise<DevtoolsSessionPayload[]> => {
  const response = await fetch("/cria/devtools/sessions");
  if (!response.ok) {
    throw new Error("Failed to fetch sessions");
  }
  return response.json() as Promise<DevtoolsSessionPayload[]>;
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

const getSessionFromUrl = (): string | null => {
  if (typeof window === "undefined") {
    return null;
  }
  return new URLSearchParams(window.location.search).get(SESSION_PARAM);
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
