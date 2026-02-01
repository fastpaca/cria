import type { DevtoolsSessionPayload } from "../shared/types.js";

export interface SessionStoreOptions {
  maxSessions: number;
}

export type SessionListener = (session: DevtoolsSessionPayload) => void;

export class SessionStore {
  private readonly maxSessions: number;
  private sessions: DevtoolsSessionPayload[] = [];
  private readonly listeners = new Set<SessionListener>();

  constructor(options: SessionStoreOptions) {
    this.maxSessions = options.maxSessions;
  }

  list(): DevtoolsSessionPayload[] {
    return [...this.sessions];
  }

  upsert(session: DevtoolsSessionPayload): void {
    const next = [
      session,
      ...this.sessions.filter((item) => item.id !== session.id),
    ].slice(0, this.maxSessions);
    this.sessions = next;
    for (const listener of this.listeners) {
      listener(session);
    }
  }

  subscribe(listener: SessionListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
