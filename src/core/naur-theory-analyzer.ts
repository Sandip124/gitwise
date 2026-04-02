import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import Database from "better-sqlite3";
import { DirectedGraph } from "graphology";
import { NAUR_SIGNALS } from "./signal-weights.js";

/**
 * Compute Naur theory signal score (0–1) per function.
 *
 * Per Naur [2]: a program is not its source code — it is the shared
 * mental model of why it exists. These signals detect evidence of
 * deliberate, theory-consistent design patterns.
 */
export function computeNaurSignals(
  repoPath: string,
  db: Database.Database,
  graph: DirectedGraph | null
): Map<string, number> {
  const results = new Map<string, number>();

  const chunks = db
    .prepare(
      `SELECT function_id, file_path, function_name FROM function_chunks WHERE repo_path = ?`
    )
    .all(repoPath) as { function_id: string; file_path: string; function_name: string }[];

  // Build cross-file pattern map: function name → how many files it appears in
  const nameToFiles = new Map<string, Set<string>>();
  for (const chunk of chunks) {
    const files = nameToFiles.get(chunk.function_name) ?? new Set();
    files.add(chunk.file_path);
    nameToFiles.set(chunk.function_name, files);
  }

  // File content cache for intentional contradiction detection
  const fileCache = new Map<string, string>();

  for (const chunk of chunks) {
    let score = 0;

    // 1. Global pattern: same function name/pattern applied across 5+ files
    const fileCount = nameToFiles.get(chunk.function_name)?.size ?? 0;
    if (fileCount >= 5) {
      score += NAUR_SIGNALS.consistentAcrossFiles;
    }

    // 2. Code contradicts best practice intentionally
    // Look for patterns that suggest deliberate deviation
    let content = fileCache.get(chunk.file_path);
    if (content === undefined) {
      try {
        content = readFileSync(resolve(repoPath, chunk.file_path), "utf-8");
      } catch {
        content = "";
      }
      fileCache.set(chunk.file_path, content);
    }

    if (content) {
      const fnIdx = content.indexOf(chunk.function_name);
      if (fnIdx !== -1) {
        const context = content.slice(
          Math.max(0, fnIdx - 200),
          Math.min(content.length, fnIdx + 1500)
        );

        // Intentional contradiction markers
        if (/\b(intentionally|deliberately|on purpose|by design|not a bug|expected behavior|known issue|working as intended|this is correct)\b/i.test(context)) {
          score += NAUR_SIGNALS.intentionalContradiction;
        }

        // Global pattern: decorator/annotation patterns applied consistently
        if (/(@\w+|#\[\w+\]|\[Attribute\]|@override|@staticmethod|@classmethod|@property)/i.test(context)) {
          const patternCount = nameToFiles.get(chunk.function_name)?.size ?? 0;
          if (patternCount >= 3) {
            score += NAUR_SIGNALS.globalPattern;
          }
        }
      }
    }

    // 3. High removal cost: function is called from many places
    if (graph && graph.hasNode(chunk.function_id)) {
      const inDegree = graph.inDegree(chunk.function_id);
      if (inDegree >= 10) {
        score += NAUR_SIGNALS.highRemovalCost;
      } else if (inDegree >= 5) {
        score += NAUR_SIGNALS.highRemovalCost * 0.5;
      }
    }

    if (score > 0) {
      results.set(chunk.function_id, Math.min(score, 1.0));
    }
  }

  return results;
}
