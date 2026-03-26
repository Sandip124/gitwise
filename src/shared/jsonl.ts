import {
  readFileSync,
  appendFileSync,
  existsSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

/**
 * JSONL (JSON Lines) utilities for the .wisegit/ shared layer.
 *
 * Each file is append-only — one JSON object per line.
 * This makes git merges trivial: concurrent appends produce no conflicts
 * because each line is independent.
 */

/**
 * Read all entries from a JSONL file.
 */
export function readJsonl<T>(filePath: string): T[] {
  if (!existsSync(filePath)) return [];

  const content = readFileSync(filePath, "utf-8");
  const results: T[] = [];

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      results.push(JSON.parse(trimmed) as T);
    } catch {
      // Skip malformed lines
    }
  }

  return results;
}

/**
 * Append a single entry to a JSONL file.
 * Creates the file and parent directories if they don't exist.
 */
export function appendJsonl<T>(filePath: string, entry: T): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const line = JSON.stringify(entry) + "\n";
  appendFileSync(filePath, line, "utf-8");
}

/**
 * Append multiple entries to a JSONL file.
 */
export function appendJsonlBatch<T>(filePath: string, entries: T[]): void {
  if (entries.length === 0) return;

  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const lines = entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
  appendFileSync(filePath, lines, "utf-8");
}

/**
 * Deduplicate JSONL entries by a key function.
 * First entry wins (by position in file = earliest append).
 */
export function deduplicateJsonl<T>(
  entries: T[],
  keyFn: (entry: T) => string
): T[] {
  const seen = new Set<string>();
  const result: T[] = [];

  for (const entry of entries) {
    const key = keyFn(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(entry);
  }

  return result;
}
