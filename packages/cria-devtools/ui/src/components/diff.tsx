import type {
  DevtoolsMessageSnapshot,
  DevtoolsSessionPayload,
} from "@shared/types";
import fastDiff from "fast-diff";
import { type ReactNode, useMemo, useState } from "react";
import { MessageTextBlock, ToggleGroup, type ToggleOption } from "./common";
import { MessageCardShell, MessageContent, MessageSnapshot } from "./messages";

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

type DiffViewMode = "inline" | "split";
type TextMode = "text" | "markdown";

const DIFF_MODE_OPTIONS: ToggleOption<DiffViewMode>[] = [
  { value: "inline", label: "Inline diff" },
  { value: "split", label: "Split" },
];

const TEXT_MODE_OPTIONS: ToggleOption<TextMode>[] = [
  { value: "text", label: "Text" },
  { value: "markdown", label: "Markdown" },
];

export const DiffViewSection = ({
  session,
}: {
  session: DevtoolsSessionPayload;
}) => {
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
