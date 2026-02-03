import type { DevtoolsSessionPayload } from "@shared/types";
import { useEffect, useState } from "react";

export const useSessionStream = (
  onSession: (session: DevtoolsSessionPayload) => void
): boolean => {
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const stream = new EventSource("/cria/devtools/stream");
    stream.addEventListener("session", (event) => {
      try {
        const data = JSON.parse(
          (event as MessageEvent<string>).data
        ) as DevtoolsSessionPayload;
        onSession(data);
      } catch {
        // ignore malformed events
      }
    });
    stream.onopen = () => setConnected(true);
    stream.onerror = () => setConnected(false);
    return () => stream.close();
  }, [onSession]);

  return connected;
};
