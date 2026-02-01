#!/usr/bin/env node
import open from "open";
import { startDevtoolsServer } from "./server/index.js";

interface CliOptions {
  host?: string;
  port?: number;
  open?: boolean;
}

const parseArgs = (args: readonly string[]): CliOptions => {
  const options: CliOptions = { open: true };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    const next = args[i + 1];
    if ((arg === "--host" || arg === "-h") && next) {
      options.host = next;
      i += 1;
      continue;
    }
    if ((arg === "--port" || arg === "-p") && next) {
      const parsed = Number(next);
      if (!Number.isNaN(parsed)) {
        options.port = parsed;
      }
      i += 1;
      continue;
    }
    if (arg === "--no-open") {
      options.open = false;
    }
  }
  return options;
};

const main = async (): Promise<void> => {
  const options = parseArgs(process.argv.slice(2));
  const serverOptions: { host?: string; port?: number } = {};
  if (options.host) {
    serverOptions.host = options.host;
  }
  if (options.port !== undefined) {
    serverOptions.port = options.port;
  }
  const server = await startDevtoolsServer(serverOptions);
  process.stdout.write(`Cria DevTools running at ${server.url}\n`);

  if (options.open) {
    try {
      await open(server.url);
    } catch {
      process.stdout.write("Open your browser to the URL above.\n");
    }
  }

  const shutdown = async (): Promise<void> => {
    process.stdout.write("Shutting down Cria DevTools...\n");
    await server.close();
    process.exit(0);
  };

  process.on("SIGINT", () => {
    shutdown().catch(() => {
      // Swallow shutdown errors on SIGINT
    });
  });

  process.on("SIGTERM", () => {
    shutdown().catch(() => {
      // Swallow shutdown errors on SIGTERM
    });
  });
};

main().catch(() => {
  // Swallow top-level errors; stdout is already written
});
