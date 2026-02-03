import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  DevtoolsSessionPayload,
  DevtoolsStatus,
} from "../shared/types.js";

export interface SessionPersistenceOptions {
  dataDir: string;
  retentionDays: number;
  retentionCount: number;
}

interface SessionFileMeta {
  filePath: string;
  session: DevtoolsSessionPayload;
  startedAtMs: number;
}

const SESSIONS_DIR = "sessions";

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object";

const isStatus = (value: unknown): value is DevtoolsStatus =>
  value === "success" || value === "error";

const assertSessionPayload = (value: unknown): DevtoolsSessionPayload => {
  if (!isObject(value)) {
    throw new Error("Invalid session payload: not an object.");
  }

  if (
    typeof value.id !== "string" ||
    typeof value.startedAt !== "string" ||
    typeof value.durationMs !== "number" ||
    !isStatus(value.status)
  ) {
    throw new Error("Invalid session payload: missing required fields.");
  }

  if (
    !(
      isObject(value.snapshots) &&
      Array.isArray(value.snapshots.before) &&
      Array.isArray(value.snapshots.after)
    )
  ) {
    throw new Error("Invalid session payload: snapshots malformed.");
  }

  if (!(Array.isArray(value.strategyEvents) && Array.isArray(value.timing))) {
    throw new Error("Invalid session payload: events malformed.");
  }

  return value as DevtoolsSessionPayload;
};

const parseSessionFile = async (filePath: string): Promise<SessionFileMeta> => {
  const text = await readFile(filePath, "utf-8");
  const parsed = JSON.parse(text) as unknown;
  const session = assertSessionPayload(parsed);
  const startedAtMs = Date.parse(session.startedAt);
  if (Number.isNaN(startedAtMs)) {
    throw new Error(`Invalid session payload: bad startedAt in ${filePath}.`);
  }
  return { filePath, session, startedAtMs };
};

const sortNewestFirst = (entries: SessionFileMeta[]): SessionFileMeta[] =>
  [...entries].sort((a, b) => b.startedAtMs - a.startedAtMs);

export class SessionPersistence {
  private readonly sessionsDir: string;
  private readonly retentionDays: number;
  private readonly retentionCount: number;

  constructor(options: SessionPersistenceOptions) {
    this.sessionsDir = join(options.dataDir, SESSIONS_DIR);
    this.retentionDays = options.retentionDays;
    this.retentionCount = options.retentionCount;
  }

  async init(): Promise<void> {
    await mkdir(this.sessionsDir, { recursive: true });
  }

  private async listFiles(): Promise<string[]> {
    await this.init();
    const entries = await readdir(this.sessionsDir);
    return entries
      .filter((name) => name.endsWith(".json"))
      .map((name) => join(this.sessionsDir, name));
  }

  async load(): Promise<DevtoolsSessionPayload[]> {
    const files = await this.listFiles();
    const sessions = await Promise.all(files.map(parseSessionFile));
    return sortNewestFirst(sessions).map((entry) => entry.session);
  }

  async get(id: string): Promise<DevtoolsSessionPayload | null> {
    const filePath = join(this.sessionsDir, `${id}.json`);
    try {
      const { session } = await parseSessionFile(filePath);
      return session;
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return null;
      }
      throw error;
    }
  }

  async save(session: DevtoolsSessionPayload): Promise<void> {
    await this.init();
    const filePath = join(this.sessionsDir, `${session.id}.json`);
    const payload = JSON.stringify(session, null, 2);
    await writeFile(filePath, payload, "utf-8");
  }

  async prune(): Promise<void> {
    const files = await this.listFiles();
    const entries = await Promise.all(files.map(parseSessionFile));
    const now = Date.now();
    const maxAgeMs =
      this.retentionDays > 0 ? this.retentionDays * 86_400_000 : 0;

    const expired = maxAgeMs
      ? entries.filter((entry) => now - entry.startedAtMs > maxAgeMs)
      : [];

    const remaining = entries.filter(
      (entry) => !expired.some((item) => item.filePath === entry.filePath)
    );
    const sortedRemaining = sortNewestFirst(remaining);
    const overCount =
      this.retentionCount > 0 ? sortedRemaining.slice(this.retentionCount) : [];

    const toRemove = [...expired, ...overCount];
    await Promise.all(toRemove.map((entry) => rm(entry.filePath)));
  }
}
