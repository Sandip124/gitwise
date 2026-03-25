import { readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { homedir } from "node:os";
import { logger } from "./logger.js";

export interface GitwiseConfig {
  dbPath: string;
  ollamaUrl: string;
  ollamaChatModel: string;
  ollamaEmbedModel: string;
}

const WISEGIT_DIR = join(homedir(), ".wisegit");

const DEFAULTS: GitwiseConfig = {
  dbPath: join(WISEGIT_DIR, "wisegit.db"),
  ollamaUrl: "http://localhost:11434",
  ollamaChatModel: "llama3",
  ollamaEmbedModel: "nomic-embed-text",
};

// Allowlisted config keys — only these are accepted from .gitwiserc.json
const ALLOWED_KEYS = new Set<keyof GitwiseConfig>([
  "dbPath",
  "ollamaUrl",
  "ollamaChatModel",
  "ollamaEmbedModel",
]);

let cachedConfig: GitwiseConfig | null = null;

/**
 * Safely pick only known config keys from an untrusted object.
 * Prevents prototype pollution and arbitrary property injection.
 */
function pickValidConfig(raw: unknown): Partial<GitwiseConfig> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return {};
  }

  const result: Partial<GitwiseConfig> = {};
  const obj = raw as Record<string, unknown>;

  for (const key of ALLOWED_KEYS) {
    if (key in obj && typeof obj[key] === "string") {
      result[key] = obj[key] as string;
    }
  }

  return result;
}

export function loadConfig(repoPath?: string): GitwiseConfig {
  if (cachedConfig) return cachedConfig;

  const config = { ...DEFAULTS };

  // Override from .gitwiserc.json if it exists
  const rcPath = repoPath
    ? resolve(repoPath, ".gitwiserc.json")
    : resolve(process.cwd(), ".gitwiserc.json");

  if (existsSync(rcPath)) {
    try {
      const raw = JSON.parse(readFileSync(rcPath, "utf-8"));
      const validated = pickValidConfig(raw);
      Object.assign(config, validated);
    } catch {
      // Ignore invalid JSON
    }
  }

  // Override from environment variables
  if (process.env.WISEGIT_DB_PATH) config.dbPath = process.env.WISEGIT_DB_PATH;
  if (process.env.OLLAMA_URL) config.ollamaUrl = process.env.OLLAMA_URL;
  if (process.env.OLLAMA_CHAT_MODEL)
    config.ollamaChatModel = process.env.OLLAMA_CHAT_MODEL;
  if (process.env.OLLAMA_EMBED_MODEL)
    config.ollamaEmbedModel = process.env.OLLAMA_EMBED_MODEL;

  cachedConfig = config;
  return config;
}

export function resetConfigCache(): void {
  cachedConfig = null;
}

export function getWisegitDir(): string {
  return WISEGIT_DIR;
}
