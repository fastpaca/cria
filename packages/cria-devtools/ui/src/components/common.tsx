import { type ReactNode, useState } from "react";
import { cx } from "../utils/cx";

export interface ToggleOption<T extends string> {
  value: T;
  label: string;
}

export const ToggleGroup = <T extends string>({
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

export const MetaItem = ({
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

export const CollapsibleSection = ({
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

export const MAX_TEXT_PREVIEW = 600;

export const MessageTextBlock = ({
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
