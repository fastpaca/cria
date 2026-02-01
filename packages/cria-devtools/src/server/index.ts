import { readFile, stat } from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { DevtoolsSessionPayload } from "../shared/types.js";
import { decodeOtlpTraces } from "./otlp.js";
import { buildSessions } from "./sessions.js";
import { SessionStore } from "./store.js";
import { TraceCache } from "./trace-cache.js";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 4318;
const MAX_BODY_BYTES = 10_000_000;

const PING_PATH = "/cria/devtools/ping";
const STREAM_PATH = "/cria/devtools/stream";
const SESSIONS_PATH = "/cria/devtools/sessions";
const OTLP_TRACE_PATH = "/v1/traces";

const MIME_TYPES: Record<string, string> = {
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".html": "text/html",
};

export interface DevtoolsServerOptions {
  host?: string;
  port?: number;
  maxSessions?: number;
  traceTtlMs?: number;
  uiDir?: string;
}

export interface DevtoolsServer {
  url: string;
  host: string;
  port: number;
  close: () => Promise<void>;
}

const jsonResponse = (
  res: ServerResponse,
  status: number,
  body: unknown
): void => {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type",
  });
  res.end(payload);
};

const otlpResponse = (
  res: ServerResponse,
  contentType: string | undefined
): void => {
  if (contentType?.includes("json")) {
    jsonResponse(res, 200, {});
    return;
  }
  res.writeHead(200, {
    "content-type": "application/x-protobuf",
    "content-length": "0",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type",
  });
  res.end();
};

const readBody = async (req: IncomingMessage): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  let total = 0;

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > MAX_BODY_BYTES) {
      throw new Error("Payload too large");
    }
    chunks.push(buffer);
  }

  return Buffer.concat(chunks);
};

const resolveUiDir = (override?: string): string => {
  if (override) {
    return override;
  }
  const currentDir = dirname(fileURLToPath(import.meta.url));
  return resolve(currentDir, "../../ui/dist");
};

const getMimeType = (filePath: string): string => {
  const ext = extname(filePath);
  return MIME_TYPES[ext] ?? "text/html";
};

const serveFile = async (
  res: ServerResponse,
  filePath: string
): Promise<boolean> => {
  try {
    const stats = await stat(filePath);
    if (!stats.isFile()) {
      return false;
    }
    const data = await readFile(filePath);
    res.writeHead(200, {
      "content-type": getMimeType(filePath),
      "content-length": data.byteLength,
    });
    res.end(data);
    return true;
  } catch {
    return false;
  }
};

const handleSessions = (store: SessionStore, res: ServerResponse): void => {
  jsonResponse(res, 200, store.list());
};

const handleStream = (
  store: SessionStore,
  req: IncomingMessage,
  res: ServerResponse
): void => {
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
    "access-control-allow-origin": "*",
  });

  res.write("retry: 2000\n\n");

  const unsubscribe = store.subscribe((session) => {
    res.write(`event: session\ndata: ${JSON.stringify(session)}\n\n`);
  });

  req.on("close", () => {
    unsubscribe();
  });
};

const handleOtlpTraces = async (
  store: SessionStore,
  cache: TraceCache,
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> => {
  const contentType = req.headers["content-type"];
  try {
    const body = await readBody(req);
    const spans = decodeOtlpTraces(body, contentType);
    cache.add(spans);
    cache.prune();

    const sessions: DevtoolsSessionPayload[] = [];
    for (const traceId of cache.traceIds()) {
      const traceSpans = cache.list(traceId);
      sessions.push(...buildSessions(traceSpans));
    }

    for (const session of sessions) {
      store.upsert(session);
    }

    otlpResponse(res, contentType);
  } catch (error) {
    jsonResponse(res, 400, {
      error: error instanceof Error ? error.message : "Invalid",
    });
  }
};

const handleOptions = (res: ServerResponse): void => {
  res.writeHead(204, {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type",
  });
  res.end();
};

const handleStaticFile = async (
  res: ServerResponse,
  pathname: string,
  uiDir: string
): Promise<void> => {
  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  if (requestedPath.includes("..")) {
    jsonResponse(res, 400, { error: "Invalid path" });
    return;
  }
  const normalizedPath = requestedPath.startsWith("/")
    ? requestedPath.slice(1)
    : requestedPath;
  const filePath = join(uiDir, normalizedPath);
  const ok = await serveFile(res, filePath);
  if (!ok && requestedPath !== "/index.html") {
    const fallback = await serveFile(res, join(uiDir, "index.html"));
    if (!fallback) {
      jsonResponse(res, 404, { error: "Not found" });
    }
  }
};

export const startDevtoolsServer = async (
  options: DevtoolsServerOptions = {}
): Promise<DevtoolsServer> => {
  const host = options.host ?? DEFAULT_HOST;
  const port = options.port ?? DEFAULT_PORT;
  const uiDir = resolveUiDir(options.uiDir);
  const store = new SessionStore({ maxSessions: options.maxSessions ?? 100 });
  const cache = new TraceCache({ ttlMs: options.traceTtlMs ?? 120_000 });

  const server = createServer(async (req, res) => {
    if (!req.url) {
      jsonResponse(res, 400, { error: "Missing URL" });
      return;
    }
    const parsedUrl = new URL(req.url, `http://${host}:${port}`);
    const pathname = parsedUrl.pathname;

    if (req.method === "OPTIONS") {
      handleOptions(res);
      return;
    }

    if (req.method === "GET" && pathname === PING_PATH) {
      jsonResponse(res, 200, { ok: true });
      return;
    }

    if (req.method === "GET" && pathname === SESSIONS_PATH) {
      handleSessions(store, res);
      return;
    }

    if (req.method === "GET" && pathname === STREAM_PATH) {
      handleStream(store, req, res);
      return;
    }

    if (req.method === "POST" && pathname === OTLP_TRACE_PATH) {
      await handleOtlpTraces(store, cache, req, res);
      return;
    }

    if (req.method === "GET") {
      await handleStaticFile(res, pathname, uiDir);
      return;
    }

    jsonResponse(res, 404, { error: "Not found" });
  });

  await new Promise<void>((resolvePromise) => {
    server.listen(port, host, () => resolvePromise());
  });

  return {
    url: `http://${host}:${port}`,
    host,
    port,
    close: () =>
      new Promise((resolvePromise, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolvePromise();
        });
      }),
  };
};
