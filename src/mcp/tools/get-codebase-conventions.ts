import Database from "better-sqlite3";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, dirname, extname, basename } from "node:path";

/**
 * Extract codebase conventions for a file's neighborhood.
 *
 * Analyzes sibling files (same directory + same language) to detect:
 * - Naming conventions (camelCase, snake_case, PascalCase)
 * - Import/export patterns
 * - Error handling patterns
 * - Commit style (structured, descriptive)
 * - Protection density (how carefully this area is maintained)
 *
 * This gives AI agents the context to write code that is cohesive
 * with the existing codebase rather than introducing foreign patterns.
 */

interface Convention {
  category: string;
  pattern: string;
  confidence: number;  // 0-1: how consistently this pattern appears
  examples: string[];
}

interface ConventionsResult {
  filePath: string;
  directory: string;
  conventions: Convention[];
  protectionDensity: string;  // "high" | "moderate" | "low"
  commitStyle: string;        // "structured" | "descriptive" | "mixed"
  formatted: string;
}

export function getCodebaseConventions(
  db: Database.Database,
  filePath: string,
  repoPath?: string
): ConventionsResult {
  const repo = repoPath ?? "";
  const dir = dirname(filePath);
  const ext = extname(filePath);
  const conventions: Convention[] = [];

  // Get sibling functions from the same directory
  const siblingFunctions = db.prepare(`
    SELECT function_name, file_path FROM function_chunks
    WHERE repo_path = ? AND file_path LIKE ?
    ORDER BY function_name
  `).all(repo, `${dir}%`) as { function_name: string; file_path: string }[];

  // Get same-language functions across the repo
  const sameLangFunctions = db.prepare(`
    SELECT function_name FROM function_chunks
    WHERE repo_path = ? AND file_path LIKE ?
    LIMIT 500
  `).all(repo, `%${ext}`) as { function_name: string }[];

  // 1. Naming conventions
  const namingResult = detectNamingConvention(
    siblingFunctions.map(f => f.function_name),
    sameLangFunctions.map(f => f.function_name)
  );
  if (namingResult) conventions.push(namingResult);

  // 2. Import/export patterns (from sibling file content)
  const siblingFiles = getSiblingFiles(repo, dir, ext);
  const importPattern = detectImportPattern(siblingFiles);
  if (importPattern) conventions.push(importPattern);

  const exportPattern = detectExportPattern(siblingFiles);
  if (exportPattern) conventions.push(exportPattern);

  // 3. Error handling pattern
  const errorPattern = detectErrorPattern(siblingFiles);
  if (errorPattern) conventions.push(errorPattern);

  // 4. Comment/docstring conventions
  const commentPattern = detectCommentPattern(siblingFiles);
  if (commentPattern) conventions.push(commentPattern);

  // 5. Commit style for this directory
  const commitRows = db.prepare(`
    SELECT classification, COUNT(*) as cnt
    FROM decision_events
    WHERE repo_path = ? AND file_path LIKE ? AND classification IS NOT NULL
    GROUP BY classification ORDER BY cnt DESC
  `).all(repo, `${dir}%`) as { classification: string; cnt: number }[];

  const totalCommits = commitRows.reduce((s, r) => s + r.cnt, 0);
  const structuredPct = (commitRows.find(r => r.classification === "STRUCTURED")?.cnt ?? 0) / Math.max(totalCommits, 1);
  const commitStyle = structuredPct > 0.5 ? "structured" : structuredPct > 0.1 ? "mixed" : "descriptive";

  if (totalCommits > 0) {
    conventions.push({
      category: "Commit style",
      pattern: commitStyle === "structured"
        ? "Use conventional prefixes (feat:, fix:, refactor:)"
        : "Use descriptive commit messages explaining the change",
      confidence: Math.max(structuredPct, 1 - structuredPct),
      examples: [],
    });
  }

  // 6. Protection density for this directory
  const scoreRows = db.prepare(`
    SELECT score FROM freeze_scores WHERE repo_path = ? AND file_path LIKE ?
  `).all(repo, `${dir}%`) as { score: number }[];

  const avgScore = scoreRows.length > 0
    ? scoreRows.reduce((s, r) => s + r.score, 0) / scoreRows.length
    : 0;
  const protectionDensity = avgScore >= 0.5 ? "high" : avgScore >= 0.2 ? "moderate" : "low";

  if (scoreRows.length > 0) {
    conventions.push({
      category: "Protection density",
      pattern: protectionDensity === "high"
        ? "This area has high decision density — match existing patterns carefully"
        : protectionDensity === "moderate"
          ? "This area has verified patterns — review before deviating"
          : "This area is actively evolving — new patterns are acceptable",
      confidence: avgScore,
      examples: [],
    });
  }

  // 7. Common function patterns in this directory
  const patternConv = detectFunctionPatterns(siblingFunctions.map(f => f.function_name));
  if (patternConv) conventions.push(patternConv);

  const formatted = formatConventions(filePath, dir, conventions, protectionDensity, commitStyle);

  return {
    filePath,
    directory: dir,
    conventions,
    protectionDensity,
    commitStyle,
    formatted,
  };
}

// ── Pattern Detectors ──

function detectNamingConvention(
  siblingNames: string[],
  allNames: string[]
): Convention | null {
  if (siblingNames.length < 3) return null;

  const names = siblingNames.length >= 10 ? siblingNames : allNames;
  let camel = 0, snake = 0, pascal = 0;

  for (const name of names) {
    if (/^[a-z][a-zA-Z0-9]*$/.test(name) && /[A-Z]/.test(name)) camel++;
    else if (/^[a-z][a-z0-9_]*$/.test(name) && name.includes("_")) snake++;
    else if (/^[A-Z][a-zA-Z0-9]*$/.test(name)) pascal++;
  }

  const total = camel + snake + pascal;
  if (total < 3) return null;

  const dominant = Math.max(camel, snake, pascal);
  const style = dominant === camel ? "camelCase" : dominant === snake ? "snake_case" : "PascalCase";
  const pct = dominant / total;

  return {
    category: "Naming",
    pattern: `Use ${style} for function names (${(pct * 100).toFixed(0)}% of ${total} functions)`,
    confidence: pct,
    examples: siblingNames.slice(0, 3),
  };
}

function detectImportPattern(files: Map<string, string>): Convention | null {
  let esImport = 0, require = 0, fromImport = 0, using = 0;

  for (const content of files.values()) {
    const first50Lines = content.split("\n").slice(0, 50).join("\n");
    if (/import\s+.*\s+from\s+/.test(first50Lines)) esImport++;
    if (/require\s*\(/.test(first50Lines)) require++;
    if (/from\s+\w+\s+import/.test(first50Lines)) fromImport++;
    if (/^using\s+/m.test(first50Lines)) using++;
  }

  const total = esImport + require + fromImport + using;
  if (total < 2) return null;

  const dominant = Math.max(esImport, require, fromImport, using);
  let style: string;
  if (dominant === esImport) style = "ES module imports (import X from 'Y')";
  else if (dominant === require) style = "CommonJS require (const X = require('Y'))";
  else if (dominant === fromImport) style = "Python imports (from X import Y)";
  else style = "C# using directives";

  return {
    category: "Imports",
    pattern: style,
    confidence: dominant / total,
    examples: [],
  };
}

function detectExportPattern(files: Map<string, string>): Convention | null {
  let named = 0, defaultExport = 0, moduleExports = 0;

  for (const content of files.values()) {
    if (/export\s+(?:function|class|const|interface)/.test(content)) named++;
    if (/export\s+default/.test(content)) defaultExport++;
    if (/module\.exports/.test(content)) moduleExports++;
  }

  const total = named + defaultExport + moduleExports;
  if (total < 2) return null;

  const dominant = Math.max(named, defaultExport, moduleExports);
  const style = dominant === named ? "Named exports" : dominant === defaultExport ? "Default exports" : "module.exports";

  return {
    category: "Exports",
    pattern: style,
    confidence: dominant / total,
    examples: [],
  };
}

function detectErrorPattern(files: Map<string, string>): Convention | null {
  let tryCatch = 0, catchPromise = 0, resultType = 0, ifErr = 0;

  for (const content of files.values()) {
    if (/try\s*\{/.test(content) || /try\s*:/.test(content)) tryCatch++;
    if (/\.catch\s*\(/.test(content)) catchPromise++;
    if (/Result<|Ok\(|Err\(/.test(content)) resultType++;
    if (/if\s+err\s*!=/.test(content) || /if\s+.*error/.test(content)) ifErr++;
  }

  const total = tryCatch + catchPromise + resultType + ifErr;
  if (total < 2) return null;

  const dominant = Math.max(tryCatch, catchPromise, resultType, ifErr);
  let style: string;
  if (dominant === tryCatch) style = "try/catch blocks";
  else if (dominant === catchPromise) style = "Promise .catch() chains";
  else if (dominant === resultType) style = "Result/Ok/Err types";
  else style = "if-error checks";

  return {
    category: "Error handling",
    pattern: `Use ${style} for error handling`,
    confidence: dominant / total,
    examples: [],
  };
}

function detectCommentPattern(files: Map<string, string>): Convention | null {
  let jsdoc = 0, docstring = 0, inline = 0, none = 0;

  for (const content of files.values()) {
    if (/\/\*\*/.test(content)) jsdoc++;
    else if (/"""[\s\S]*?"""/.test(content) || /'''[\s\S]*?'''/.test(content)) docstring++;
    else if (/\/\//.test(content) || /#\s/.test(content)) inline++;
    else none++;
  }

  const total = jsdoc + docstring + inline + none;
  if (total < 2) return null;

  const documented = jsdoc + docstring;
  if (documented > total * 0.5) {
    const style = jsdoc > docstring ? "JSDoc (/** ... */)" : "Docstrings";
    return {
      category: "Documentation",
      pattern: `Functions are documented with ${style}`,
      confidence: documented / total,
      examples: [],
    };
  }

  return null;
}

function detectFunctionPatterns(names: string[]): Convention | null {
  // Detect common prefixes: get_, set_, is_, has_, create_, find_, etc.
  const prefixCounts = new Map<string, number>();
  for (const name of names) {
    const match = name.match(/^(get|set|is|has|create|find|update|delete|remove|add|check|validate|parse|format|build|make|handle|process|on|init|_)/i);
    if (match) {
      const prefix = match[1].toLowerCase();
      prefixCounts.set(prefix, (prefixCounts.get(prefix) ?? 0) + 1);
    }
  }

  const dominant = [...prefixCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  if (dominant.length === 0 || dominant[0][1] < 3) return null;

  const patterns = dominant.map(([prefix, count]) => `${prefix}_* (${count})`).join(", ");

  return {
    category: "Function patterns",
    pattern: `Common prefixes: ${patterns}`,
    confidence: dominant[0][1] / names.length,
    examples: names.filter(n => n.toLowerCase().startsWith(dominant[0][0])).slice(0, 3),
  };
}

// ── Helpers ──

function getSiblingFiles(repoPath: string, dir: string, ext: string): Map<string, string> {
  const files = new Map<string, string>();
  const fullDir = resolve(repoPath, dir);

  try {
    const entries = readdirSync(fullDir);
    for (const entry of entries) {
      if (!entry.endsWith(ext)) continue;
      if (files.size >= 10) break; // Limit to 10 files for performance
      try {
        const full = resolve(fullDir, entry);
        const stat = statSync(full);
        if (stat.isFile() && stat.size < 100_000) { // Skip large files
          files.set(entry, readFileSync(full, "utf-8"));
        }
      } catch { /* skip */ }
    }
  } catch { /* directory not accessible */ }

  return files;
}

function formatConventions(
  filePath: string,
  dir: string,
  conventions: Convention[],
  protectionDensity: string,
  commitStyle: string
): string {
  if (conventions.length === 0) {
    return [
      `Codebase conventions for: ${filePath}`,
      "",
      "No strong conventions detected in this area.",
      "This may be a new or evolving part of the codebase.",
    ].join("\n");
  }

  const lines = [
    `Codebase conventions for: ${filePath}`,
    `Directory: ${dir}/`,
    `Protection: ${protectionDensity} | Commits: ${commitStyle}`,
    "\u2501".repeat(50),
    "",
  ];

  for (const conv of conventions) {
    const conf = conv.confidence >= 0.8 ? "strong" : conv.confidence >= 0.5 ? "moderate" : "weak";
    lines.push(`[${conv.category}] ${conv.pattern} (${conf} convention)`);
    if (conv.examples.length > 0) {
      lines.push(`  Examples: ${conv.examples.join(", ")}`);
    }
  }

  lines.push("");
  lines.push("\u2501".repeat(50));
  lines.push("Follow these conventions to maintain codebase cohesion.");
  lines.push("Deviating creates maintenance burden for future contributors.");

  return lines.join("\n");
}
