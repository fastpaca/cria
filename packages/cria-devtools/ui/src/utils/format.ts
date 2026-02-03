export const formatDuration = (ms?: number): string => {
  if (!ms && ms !== 0) {
    return "-";
  }
  if (ms < 1000) {
    return `${ms.toFixed(0)}ms`;
  }
  return `${(ms / 1000).toFixed(2)}s`;
};

export const formatTokens = (before?: number, after?: number): string => {
  if (before === undefined) {
    return "-";
  }
  if (after === undefined || after === before) {
    return `${before}`;
  }
  return `${before} → ${after}`;
};

export const formatDate = (iso: string, includeDate = false): string =>
  new Date(iso)[includeDate ? "toLocaleString" : "toLocaleTimeString"]();

export const tokenDeltaClass = (delta: number | undefined): string => {
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

export const formatTokenDelta = (delta: number | undefined): string => {
  if (delta === undefined) {
    return "-";
  }
  return `${delta > 0 ? "+" : ""}${delta}`;
};
