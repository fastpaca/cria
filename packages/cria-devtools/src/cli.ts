#!/usr/bin/env node
import open from "open";
import { startDevtoolsServer } from "./server/index.js";

interface CliOptions {
  host?: string;
  port?: number;
  open?: boolean;
  dataDir?: string;
  retentionDays?: number;
  retentionCount?: number;
  persist?: boolean;
}

const parseNumber = (value: string | undefined): number | undefined => {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isNaN(parsed) ? undefined : parsed;
};

const applyOption = (
  options: CliOptions,
  arg: string,
  next: string | undefined
): number => {
  switch (arg) {
    case "--host":
    case "-h":
      if (next) {
        options.host = next;
        return 1;
      }
      return 0;
    case "--port":
    case "-p": {
      const parsed = parseNumber(next);
      if (parsed !== undefined) {
        options.port = parsed;
      }
      return next ? 1 : 0;
    }
    case "--data-dir":
      if (next) {
        options.dataDir = next;
        return 1;
      }
      return 0;
    case "--retention-days": {
      const parsed = parseNumber(next);
      if (parsed !== undefined) {
        options.retentionDays = parsed;
      }
      return next ? 1 : 0;
    }
    case "--retention-count": {
      const parsed = parseNumber(next);
      if (parsed !== undefined) {
        options.retentionCount = parsed;
      }
      return next ? 1 : 0;
    }
    case "--no-open":
      options.open = false;
      return 0;
    case "--no-persist":
      options.persist = false;
      return 0;
    default:
      return 0;
  }
};

const parseArgs = (args: readonly string[]): CliOptions => {
  const options: CliOptions = { open: true, persist: true };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    const next = args[i + 1];
    i += applyOption(options, arg, next);
  }
  return options;
};

const main = async (): Promise<void> => {
  const options = parseArgs(process.argv.slice(2));
  const serverOptions: {
    host?: string;
    port?: number;
    dataDir?: string;
    retentionDays?: number;
    retentionCount?: number;
    persistSessions?: boolean;
  } = {};
  if (options.host) {
    serverOptions.host = options.host;
  }
  if (options.port !== undefined) {
    serverOptions.port = options.port;
  }
  if (options.dataDir) {
    serverOptions.dataDir = options.dataDir;
  }
  if (options.retentionDays !== undefined) {
    serverOptions.retentionDays = options.retentionDays;
  }
  if (options.retentionCount !== undefined) {
    serverOptions.retentionCount = options.retentionCount;
  }
  if (options.persist === false) {
    serverOptions.persistSessions = false;
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
