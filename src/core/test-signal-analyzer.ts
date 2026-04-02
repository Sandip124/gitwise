import { readdirSync, readFileSync, existsSync } from "node:fs";
import { resolve, basename, dirname, relative } from "node:path";
import Database from "better-sqlite3";
import { TEST_SIGNALS } from "./signal-weights.js";

/**
 * Compute test signal score (0–1) per function.
 *
 * Per Naur [2]: dedicated tests are written theory evidence.
 * Per Aranda [3]: edge case labels indicate platform-specific decisions.
 * Per Hericko [4]: tests in the same commit as code show intent coherence.
 */
export function computeTestSignals(
  repoPath: string,
  db: Database.Database
): Map<string, number> {
  const results = new Map<string, number>();

  // Step 1: Find all test files in the repo
  const testFiles = findTestFiles(repoPath);
  const testContentMap = new Map<string, string>();

  for (const testFile of testFiles) {
    try {
      testContentMap.set(testFile, readFileSync(resolve(repoPath, testFile), "utf-8"));
    } catch { /* skip unreadable */ }
  }

  // Step 2: Get all tracked functions
  const chunks = db
    .prepare(
      `SELECT function_id, file_path, function_name FROM function_chunks WHERE repo_path = ?`
    )
    .all(repoPath) as { function_id: string; file_path: string; function_name: string }[];

  // Step 3: For each function, check if a test references it
  for (const chunk of chunks) {
    let score = 0;

    // Check if any test file references this function by name
    const fnName = chunk.function_name;
    if (fnName.length < 3) continue; // Skip very short names (avoid false matches)

    for (const [testFile, testContent] of testContentMap) {
      // Dedicated test: test file mentions the function name
      if (testContent.includes(fnName)) {
        score += TEST_SIGNALS.dedicatedTest;

        // Edge case label: test mentions platform/environment-specific terms
        const surroundingTest = extractTestContext(testContent, fnName);
        if (surroundingTest && /\b(safari|ios|android|chrome|firefox|edge|race\s*condition|timeout|retry|concurrent|async|unicode|utf|locale|timezone|daylight|leap|overflow|boundary|null|empty|zero)\b/i.test(surroundingTest)) {
          score += TEST_SIGNALS.edgeCaseLabel;
        }

        break; // One matching test file is enough
      }
    }

    // Test in same commit: check if any test file was modified in the same commit as this function
    if (score > 0) {
      const sameCommitTest = db
        .prepare(`
          SELECT COUNT(*) as cnt FROM decision_events a
          JOIN decision_events b ON a.commit_sha = b.commit_sha
          WHERE a.function_id = ? AND a.repo_path = ?
            AND b.file_path LIKE '%test%' AND a.function_id != b.function_id
          LIMIT 1
        `)
        .get(chunk.function_id, repoPath) as { cnt: number } | undefined;

      if (sameCommitTest && sameCommitTest.cnt > 0) {
        score += TEST_SIGNALS.testSameCommit;
      }
    }

    if (score > 0) {
      results.set(chunk.function_id, Math.min(score, 1.0));
    }
  }

  return results;
}

function findTestFiles(repoPath: string): string[] {
  const testFiles: string[] = [];

  function walk(dir: string): void {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch { return; }

    for (const entry of entries) {
      if (entry.startsWith(".") || entry === "node_modules" || entry === "dist" || entry === "vendor" || entry === "__pycache__") continue;
      const full = resolve(dir, entry);
      let stat;
      try {
        stat = require("node:fs").lstatSync(full);
      } catch { continue; }
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) {
        walk(full);
      } else if (stat.isFile() && isTestFile(entry)) {
        testFiles.push(relative(repoPath, full));
      }
    }
  }

  walk(repoPath);
  return testFiles;
}

function isTestFile(filename: string): boolean {
  return /\.(test|spec|_test)\.(ts|js|py|cs|go|rs)$/.test(filename) ||
    /^test_\w+\.(py|ts|js|go|rs)$/.test(filename) ||
    /tests?\.(ts|js|py)$/.test(filename) ||
    filename.includes("__tests__") ||
    filename.startsWith("test_") ||
    /^conftest\.py$/.test(filename) ||
    /testing_data/.test(filename);
}

function extractTestContext(testContent: string, fnName: string): string | null {
  const idx = testContent.indexOf(fnName);
  if (idx === -1) return null;
  return testContent.slice(Math.max(0, idx - 500), Math.min(testContent.length, idx + 500));
}
