import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

export interface GitwiseConfig {
  databaseUrl: string;
  ollamaUrl: string;
  ollamaChatModel: string;
  ollamaEmbedModel: string;
}

const DEFAULTS: GitwiseConfig = {
  databaseUrl: "postgresql://gitwise:gitwise@localhost:5433/gitwise",
  ollamaUrl: "http://localhost:11434",
  ollamaChatModel: "llama3",
  ollamaEmbedModel: "nomic-embed-text",
};

let cachedConfig: GitwiseConfig | null = null;

export function loadConfig(repoPath?: string): GitwiseConfig {
  if (cachedConfig) return cachedConfig;

  // Start with defaults
  const config = { ...DEFAULTS };

  // Override from .gitwiserc.json if it exists
  const rcPath = repoPath
    ? resolve(repoPath, ".gitwiserc.json")
    : resolve(process.cwd(), ".gitwiserc.json");

  if (existsSync(rcPath)) {
    try {
      const rc = JSON.parse(readFileSync(rcPath, "utf-8"));
      Object.assign(config, rc);
    } catch {
      // Ignore invalid JSON
    }
  }

  // Override from environment variables
  if (process.env.DATABASE_URL) config.databaseUrl = process.env.DATABASE_URL;
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
