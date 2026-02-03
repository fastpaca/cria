export const deepParseJson = (obj: unknown): unknown => {
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

export const isPlainObject = (
  value: unknown
): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

export const formatPrimitive = (value: unknown): string => {
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

export const primitiveClass = (value: unknown): string => {
  if (value === null) {
    return "json-null";
  }
  if (value === undefined) {
    return "json-undefined";
  }
  return `json-${typeof value}`;
};

export const stableKeyForValue = (value: unknown): string => {
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
