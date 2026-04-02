import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import Database from "better-sqlite3";
import { CODE_STRUCTURE_SIGNALS } from "./signal-weights.js";

/**
 * Compute code structure signal score (0–1) per function.
 *
 * Per Naur [2]: theory leaks into text — inline comments, magic numbers,
 * and defensive patterns are evidence of intentional decisions.
 * Per Giger [6]: AST-level change type matters more than line count.
 */
export function computeCodeStructureSignals(
  repoPath: string,
  db: Database.Database
): Map<string, number> {
  const results = new Map<string, number>();

  const chunks = db
    .prepare(
      `SELECT function_id, file_path, function_name FROM function_chunks WHERE repo_path = ?`
    )
    .all(repoPath) as { function_id: string; file_path: string; function_name: string }[];

  const fileCache = new Map<string, string>();

  for (const chunk of chunks) {
    let content = fileCache.get(chunk.file_path);
    if (content === undefined) {
      try {
        content = readFileSync(resolve(repoPath, chunk.file_path), "utf-8");
      } catch {
        content = "";
      }
      fileCache.set(chunk.file_path, content);
    }

    if (!content) continue;

    const fnBody = extractFunctionBody(content, chunk.function_name);
    if (!fnBody) continue;

    let score = 0;

    // Inline comments near or inside the function
    const commentLines = fnBody.split("\n").filter(l =>
      /^\s*(\/\/|#|\/\*|\*|"""|''')/.test(l)
    ).length;
    if (commentLines > 0) {
      score += CODE_STRUCTURE_SIGNALS.inlineComment;
    }

    // Comment keywords indicating intentional decisions
    if (/\b(intentional|do\s+not|don't|hack|workaround|note:|important:|warning:|fixme:|todo:|careful|deliberately|on\s+purpose)\b/i.test(fnBody)) {
      score += CODE_STRUCTURE_SIGNALS.commentKeywords;
    }

    // Magic numbers (non-obvious numeric literals, not 0/1/-1/2/100)
    const magicNumbers = fnBody.match(/(?<![a-zA-Z_])\b\d+\.?\d*\b/g)?.filter(n => {
      const v = parseFloat(n);
      return !isNaN(v) && v !== 0 && v !== 1 && v !== -1 && v !== 2 && v !== 100 && v !== 10 && v !== 1000;
    }) ?? [];
    if (magicNumbers.length > 0) {
      score += CODE_STRUCTURE_SIGNALS.magicNumber;
    }

    // Defensive patterns: null checks, double guards, assertions
    if (/(?:!=\s*null|is\s+not\s+None|!==\s*undefined|!==\s*null|\?\?|assert\b|guard\b|if\s+not\s+|\.is_none\(\))/i.test(fnBody)) {
      score += CODE_STRUCTURE_SIGNALS.defensivePattern;
    }

    // Try-catch wrapping specific operations
    if (/\b(try\s*[{:]|except\b|catch\b|rescue\b)/i.test(fnBody)) {
      score += CODE_STRUCTURE_SIGNALS.tryCatchSpecific;
    }

    // Style contradiction: unusual patterns that stand out
    // (e.g., sleep(), setTimeout with specific values, manual retry logic)
    if (/\b(sleep|setTimeout|setInterval|time\.sleep|Thread\.Sleep|retry|backoff)\b/i.test(fnBody)) {
      score += CODE_STRUCTURE_SIGNALS.styleContradiction;
    }

    results.set(chunk.function_id, Math.min(score, 1.0));
  }

  return results;
}

function extractFunctionBody(content: string, functionName: string): string | null {
  // Find the function declaration and extract ~50 lines after it
  const escapedName = functionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `(?:def|function|func|fn|(?:public|private|protected|static|async)\\s+)\\s*${escapedName}\\b`,
    "m"
  );
  const match = content.match(pattern);
  if (!match || match.index === undefined) {
    // Fallback: just search for the name
    const idx = content.indexOf(functionName);
    if (idx === -1) return null;
    return content.slice(idx, Math.min(content.length, idx + 3000));
  }

  const start = match.index;
  const end = Math.min(content.length, start + 3000); // ~50 lines
  return content.slice(start, end);
}
