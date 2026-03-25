/**
 * Logger that writes exclusively to stderr.
 *
 * Critical constraint: stdout is reserved for MCP JSON-RPC protocol.
 * Any console.log() would corrupt the MCP stream.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

let currentLevel: LogLevel = "info";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[currentLevel];
}

function formatMessage(level: LogLevel, message: string, data?: unknown): string {
  const timestamp = new Date().toISOString();
  const base = `[${timestamp}] [${level.toUpperCase()}] ${message}`;
  if (data !== undefined) {
    return `${base} ${JSON.stringify(data)}`;
  }
  return base;
}

export const logger = {
  debug(message: string, data?: unknown): void {
    if (shouldLog("debug")) {
      process.stderr.write(formatMessage("debug", message, data) + "\n");
    }
  },

  info(message: string, data?: unknown): void {
    if (shouldLog("info")) {
      process.stderr.write(formatMessage("info", message, data) + "\n");
    }
  },

  warn(message: string, data?: unknown): void {
    if (shouldLog("warn")) {
      process.stderr.write(formatMessage("warn", message, data) + "\n");
    }
  },

  error(message: string, data?: unknown): void {
    if (shouldLog("error")) {
      process.stderr.write(formatMessage("error", message, data) + "\n");
    }
  },
};
