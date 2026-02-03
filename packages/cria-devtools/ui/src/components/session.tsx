import type { DevtoolsSessionPayload } from "@shared/types";
import { useState } from "react";
import { cx } from "../utils/cx";
import { downloadJson } from "../utils/download";
import {
  formatDate,
  formatDuration,
  formatTokenDelta,
  formatTokens,
  tokenDeltaClass,
} from "../utils/format";
import { MetaItem, ToggleGroup, type ToggleOption } from "./common";
import { DiffViewSection } from "./diff";
import { JsonViewer } from "./json-viewer";
import { MessageSnapshot } from "./messages";

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

const DETAIL_TABS = [
  { key: "payload", label: "Payload" },
  { key: "diff", label: "Diff" },
  { key: "raw", label: "Raw" },
] as const;

type PayloadViewMode = "after" | "before";
type RawViewMode = "tree" | "raw";
type TextMode = "text" | "markdown";

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

export const SessionDetails = ({
  session,
}: {
  session: DevtoolsSessionPayload;
}) => {
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
