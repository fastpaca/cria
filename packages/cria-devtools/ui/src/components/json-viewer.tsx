import type { ReactNode } from "react";
import {
  formatPrimitive,
  isPlainObject,
  primitiveClass,
  stableKeyForValue,
} from "../utils/json";

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

export const JsonViewer = ({ value }: { value: unknown }) => {
  return <div className="json-viewer">{renderJsonValue(value)}</div>;
};
