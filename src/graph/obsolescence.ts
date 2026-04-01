import Database from "better-sqlite3";
import { DirectedGraph } from "graphology";
import { readFileSync, existsSync } from "node:fs";
import { resolve, basename } from "node:path";
import { ObsolescenceBreakdown } from "../core/types.js";
import {
  OBSOLESCENCE_WEIGHTS,
  MAX_OBSOLESCENCE_PENALTY,
  STALE_THRESHOLD_MONTHS,
} from "../core/signal-weights.js";
import { CalibratedWeights } from "../core/calibration.js";
import { logger } from "../shared/logger.js";

// ── Entry point ──

export interface ObsolescenceContext {
  repoPath: string;
  db: Database.Database;
  graph: DirectedGraph;
  branch?: string;
  calibratedWeights?: CalibratedWeights; // From entropy calibration
}

/**
 * Compute obsolescence penalties for all functions on the given branch.
 * Uses calibrated weights if available, falls back to hardcoded defaults.
 *
 * Returns a Map from functionId → ObsolescenceBreakdown.
 * Also returns the raw signal maps for calibration input.
 */
export function computeObsolescencePenalties(
  ctx: ObsolescenceContext
): { penalties: Map<string, ObsolescenceBreakdown>; signalMaps: Map<string, Record<string, number>> } {
  const deadCodeMap = detectDeadCode(ctx.graph, ctx.db, ctx.repoPath);
  const staleMap = detectStaleSubgraphs(ctx.graph, ctx.db, ctx.repoPath);
  const migrationMap = detectMigrationLeftovers(ctx.db, ctx.repoPath);
  const depMap = detectObsoleteDependencies(ctx.repoPath, ctx.db);
  const supersededMap = detectSupersededFunctions(ctx.graph, ctx.db, ctx.repoPath);
  const saadMap = detectSelfAdmittedDebt(ctx.db, ctx.repoPath);
  const burstMap = detectChangeBurstAbsence(ctx.db, ctx.repoPath);
  const divergeMap = detectCoChangeDivergence(ctx.db, ctx.repoPath);

  // Use calibrated weights or fall back to centralized defaults
  const w = ctx.calibratedWeights ?? {
    deadCode: OBSOLESCENCE_WEIGHTS.deadCode,
    staleSubgraph: OBSOLESCENCE_WEIGHTS.staleSubgraph,
    migrationLeftover: OBSOLESCENCE_WEIGHTS.migrationLeftover,
    obsoleteDependency: OBSOLESCENCE_WEIGHTS.obsoleteDependency,
    supersededFunction: OBSOLESCENCE_WEIGHTS.supersededFunction,
    selfAdmittedDebt: OBSOLESCENCE_WEIGHTS.selfAdmittedDebt,
    changeBurstAbsence: OBSOLESCENCE_WEIGHTS.changeBurstAbsence,
    coChangeDivergence: OBSOLESCENCE_WEIGHTS.coChangeDivergence,
  };

  const allMaps = [deadCodeMap, staleMap, migrationMap, depMap, supersededMap, saadMap, burstMap, divergeMap];
  const allFunctionIds = new Set<string>();
  for (const m of allMaps) {
    for (const key of m.keys()) allFunctionIds.add(key);
  }

  const penalties = new Map<string, ObsolescenceBreakdown>();
  const signalMaps = new Map<string, Record<string, number>>();

  for (const fnId of allFunctionIds) {
    const deadCode = deadCodeMap.get(fnId) ?? 0;
    const staleSubgraph = staleMap.get(fnId) ?? 0;
    const migrationLeftover = migrationMap.get(fnId) ?? 0;
    const obsoleteDependency = depMap.get(fnId) ?? 0;
    const supersededFunction = supersededMap.get(fnId) ?? 0;
    const selfAdmittedDebt = saadMap.get(fnId) ?? 0;
    const changeBurstAbsence = burstMap.get(fnId) ?? 0;
    const coChangeDivergence = divergeMap.get(fnId) ?? 0;

    const signals = {
      deadCode, staleSubgraph, migrationLeftover,
      obsoleteDependency, supersededFunction,
      selfAdmittedDebt, changeBurstAbsence, coChangeDivergence,
    };
    signalMaps.set(fnId, signals);

    const rawPenalty =
      deadCode * w.deadCode +
      staleSubgraph * w.staleSubgraph +
      migrationLeftover * w.migrationLeftover +
      obsoleteDependency * w.obsoleteDependency +
      supersededFunction * w.supersededFunction +
      selfAdmittedDebt * w.selfAdmittedDebt +
      changeBurstAbsence * w.changeBurstAbsence +
      coChangeDivergence * w.coChangeDivergence;

    const penalty = Math.min(rawPenalty, MAX_OBSOLESCENCE_PENALTY);

    if (penalty > 0) {
      penalties.set(fnId, {
        deadCode, staleSubgraph, migrationLeftover,
        obsoleteDependency, supersededFunction,
        selfAdmittedDebt, changeBurstAbsence, coChangeDivergence,
        penalty,
      });
    }
  }

  logger.info(`Obsolescence: ${penalties.size} functions with penalty > 0`);
  return { penalties, signalMaps };
}

// ── Signal 1: Dead Code (zero callers) ──

const ENTRY_POINT_FILES = new Set([
  "index.ts", "index.js", "main.ts", "main.js", "app.ts", "app.js",
  "Program.cs", "Startup.cs", "main.py", "main.go", "lib.rs", "main.rs",
]);

const FRAMEWORK_PATTERNS = /^(on[A-Z]|handle[A-Z]|setUp|tearDown|dispose|init|configure|main|constructor|render|componentDid|ngOn|use[A-Z])/;

function detectDeadCode(
  graph: DirectedGraph,
  db: Database.Database,
  repoPath: string
): Map<string, number> {
  const results = new Map<string, number>();

  for (const nodeId of graph.nodes()) {
    const inDegree = graph.inDegree(nodeId);
    if (inDegree > 0) continue; // Has callers — not dead

    const attrs = graph.getNodeAttributes(nodeId);
    const filePath = attrs.filePath as string;
    const fnName = attrs.functionName as string;

    // Exclusions: entry points called by frameworks, not by code in the graph
    const fileName = basename(filePath);
    if (ENTRY_POINT_FILES.has(fileName)) {
      results.set(nodeId, 0.5); // Reduced penalty — might have external callers
      continue;
    }

    // Framework callbacks / lifecycle hooks
    if (FRAMEWORK_PATTERNS.test(fnName)) {
      continue; // Skip — called by framework
    }

    // Test helpers — in test files
    if (/\.(test|spec|_test)\.(ts|js|cs|py|go|rs)$/.test(filePath) || filePath.includes("__tests__")) {
      continue; // Called by test framework
    }

    // Check if function is exported (heuristic: check the chunk's file for export keyword)
    const isExported = checkIfExported(repoPath, filePath, fnName);
    if (isExported) {
      results.set(nodeId, 0.5); // Reduced — might be used externally
      continue;
    }

    results.set(nodeId, 1.0); // Full dead code signal
  }

  return results;
}

function checkIfExported(repoPath: string, filePath: string, fnName: string): boolean {
  try {
    const fullPath = resolve(repoPath, filePath);
    if (!existsSync(fullPath)) return false;
    const content = readFileSync(fullPath, "utf-8");
    // Check for common export patterns
    const exportPattern = new RegExp(
      `(?:export\\s+(?:default\\s+)?(?:function|class|const|async)\\s+${escapeRegex(fnName)}|` +
      `(?:public|internal)\\s+.*\\b${escapeRegex(fnName)}\\b|` +
      `exports\\.${escapeRegex(fnName)}|` +
      `module\\.exports.*${escapeRegex(fnName)})`,
      "m"
    );
    return exportPattern.test(content);
  } catch {
    return false;
  }
}

// ── Signal 2: Stale Subgraph (all callers also dormant) ──

function detectStaleSubgraphs(
  graph: DirectedGraph,
  db: Database.Database,
  repoPath: string
): Map<string, number> {
  const results = new Map<string, number>();
  const thresholdMs = STALE_THRESHOLD_MONTHS * 30 * 24 * 60 * 60 * 1000;
  const now = Date.now();

  // Cache last activity per function
  const lastActivityCache = new Map<string, number>();
  const rows = db
    .prepare(
      `SELECT function_id, MAX(authored_at) as last_active
       FROM decision_events
       WHERE repo_path = ? AND function_id IS NOT NULL AND authored_at IS NOT NULL
       GROUP BY function_id`
    )
    .all(repoPath) as { function_id: string; last_active: string }[];

  for (const row of rows) {
    lastActivityCache.set(row.function_id, new Date(row.last_active).getTime());
  }

  for (const nodeId of graph.nodes()) {
    const lastActive = lastActivityCache.get(nodeId);
    if (!lastActive) continue;

    const monthsInactive = (now - lastActive) / (30 * 24 * 60 * 60 * 1000);
    if (monthsInactive < STALE_THRESHOLD_MONTHS) continue; // Recently active

    // Check if ALL callers are also stale
    const callers = graph.inNeighbors(nodeId);
    if (callers.length === 0) continue; // Dead code handled by signal 1

    const allCallersStale = callers.every((callerId) => {
      const callerLastActive = lastActivityCache.get(callerId);
      if (!callerLastActive) return true; // No activity at all
      return (now - callerLastActive) > thresholdMs;
    });

    if (allCallersStale) {
      // Scale by how long it's been stale: starts at threshold, full at 5 years
      const staleness = Math.min(
        (monthsInactive - STALE_THRESHOLD_MONTHS) / 36,
        1.0
      );
      results.set(nodeId, Math.max(staleness, 0.3)); // Minimum 0.3 if stale at all
    }
  }

  return results;
}

// ── Signal 3: Migration Leftovers ──

function detectMigrationLeftovers(
  db: Database.Database,
  repoPath: string
): Map<string, number> {
  const results = new Map<string, number>();

  // Load branch contexts for do_not_reintroduce and replaced patterns
  const branchRows = db
    .prepare(
      `SELECT metadata FROM decision_events
       WHERE repo_path = ? AND event_type = 'BRANCH_SNAPSHOT'`
    )
    .all(repoPath) as { metadata: string }[];

  const deprecatedPatterns: string[] = [];
  const replacedPatterns: string[] = [];

  for (const row of branchRows) {
    try {
      const meta = JSON.parse(row.metadata);
      if (meta.do_not_reintroduce) {
        deprecatedPatterns.push(...meta.do_not_reintroduce);
      }
      if (meta.replaced) {
        replacedPatterns.push(...meta.replaced);
      }
    } catch { /* skip malformed */ }
  }

  // Also load from .wisegit/branch-contexts.jsonl
  try {
    const jsonlPath = resolve(repoPath, ".wisegit", "branch-contexts.jsonl");
    if (existsSync(jsonlPath)) {
      const lines = readFileSync(jsonlPath, "utf-8").split("\n").filter(Boolean);
      for (const line of lines) {
        try {
          const ctx = JSON.parse(line);
          if (ctx.do_not_reintroduce) deprecatedPatterns.push(...ctx.do_not_reintroduce);
          if (ctx.replaced) replacedPatterns.push(...ctx.replaced);
        } catch { /* skip */ }
      }
    }
  } catch { /* skip */ }

  if (deprecatedPatterns.length === 0 && replacedPatterns.length === 0) {
    return results;
  }

  // Check each function's file for deprecated/replaced imports
  const chunks = db
    .prepare(
      `SELECT function_id, file_path FROM function_chunks WHERE repo_path = ?`
    )
    .all(repoPath) as { function_id: string; file_path: string }[];

  const fileContentCache = new Map<string, string>();

  for (const chunk of chunks) {
    let content = fileContentCache.get(chunk.file_path);
    if (content === undefined) {
      try {
        content = readFileSync(resolve(repoPath, chunk.file_path), "utf-8");
      } catch {
        content = "";
      }
      fileContentCache.set(chunk.file_path, content);
    }

    // Check do_not_reintroduce (strongest signal)
    for (const pattern of deprecatedPatterns) {
      if (content.includes(pattern)) {
        results.set(chunk.function_id, 1.0);
        break;
      }
    }

    // Check replaced (weaker signal)
    if (!results.has(chunk.function_id)) {
      for (const pattern of replacedPatterns) {
        if (content.includes(pattern)) {
          results.set(chunk.function_id, 0.7);
          break;
        }
      }
    }
  }

  return results;
}

// ── Signal 4: Obsolete Dependencies ──

const DEPENDENCY_FILES: Record<string, (content: string) => Set<string>> = {
  "package.json": (content) => {
    try {
      const pkg = JSON.parse(content);
      const deps = new Set<string>();
      for (const key of ["dependencies", "devDependencies", "peerDependencies"]) {
        if (pkg[key]) Object.keys(pkg[key]).forEach(d => deps.add(d));
      }
      return deps;
    } catch { return new Set(); }
  },
  "requirements.txt": (content) => {
    const deps = new Set<string>();
    for (const line of content.split("\n")) {
      const match = line.match(/^([a-zA-Z0-9_-]+)/);
      if (match) deps.add(match[1]);
    }
    return deps;
  },
  "Cargo.toml": (content) => {
    const deps = new Set<string>();
    const inDeps = /\[dependencies\]([\s\S]*?)(?:\n\[|\n$)/;
    const match = content.match(inDeps);
    if (match) {
      for (const line of match[1].split("\n")) {
        const m = line.match(/^(\w[\w-]*)\s*=/);
        if (m) deps.add(m[1]);
      }
    }
    return deps;
  },
  "go.mod": (content) => {
    const deps = new Set<string>();
    for (const line of content.split("\n")) {
      const match = line.match(/^\s+([\w./]+)\s+v/);
      if (match) deps.add(match[1]);
    }
    return deps;
  },
};

function detectObsoleteDependencies(
  repoPath: string,
  db: Database.Database
): Map<string, number> {
  const results = new Map<string, number>();

  // Find and parse the current dependency manifest
  let currentDeps: Set<string> | null = null;

  for (const [filename, parser] of Object.entries(DEPENDENCY_FILES)) {
    const filePath = resolve(repoPath, filename);
    if (existsSync(filePath)) {
      try {
        const content = readFileSync(filePath, "utf-8");
        currentDeps = parser(content);
        break;
      } catch { /* skip */ }
    }
  }

  if (!currentDeps || currentDeps.size === 0) return results;

  // Check each function's file for imports of packages not in current deps
  const chunks = db
    .prepare(
      `SELECT function_id, file_path FROM function_chunks WHERE repo_path = ?`
    )
    .all(repoPath) as { function_id: string; file_path: string }[];

  const fileImportCache = new Map<string, string[]>();

  for (const chunk of chunks) {
    let imports = fileImportCache.get(chunk.file_path);
    if (imports === undefined) {
      imports = extractImportSources(repoPath, chunk.file_path);
      fileImportCache.set(chunk.file_path, imports);
    }

    for (const imp of imports) {
      // Only check third-party imports (not relative paths)
      if (imp.startsWith(".") || imp.startsWith("/")) continue;

      // Get the package name (e.g., "@scope/pkg" from "@scope/pkg/foo")
      const pkgName = imp.startsWith("@")
        ? imp.split("/").slice(0, 2).join("/")
        : imp.split("/")[0];

      // Check if package is NOT in current deps (but is a real package import)
      if (pkgName && !currentDeps.has(pkgName) && !isBuiltinModule(pkgName)) {
        results.set(chunk.function_id, 0.8);
        break;
      }
    }
  }

  return results;
}

function extractImportSources(repoPath: string, filePath: string): string[] {
  try {
    const content = readFileSync(resolve(repoPath, filePath), "utf-8");
    const imports: string[] = [];

    // JS/TS imports
    const jsImports = content.matchAll(/(?:from\s+|require\s*\(\s*)['"]([^'"]+)['"]/g);
    for (const m of jsImports) imports.push(m[1]);

    // C# using
    const csImports = content.matchAll(/using\s+(?:static\s+)?([A-Za-z][\w.]*)\s*;/g);
    for (const m of csImports) imports.push(m[1]);

    // Python imports
    const pyImports = content.matchAll(/(?:from\s+([\w.]+)\s+import|import\s+([\w.]+))/g);
    for (const m of pyImports) imports.push(m[1] || m[2]);

    return imports;
  } catch {
    return [];
  }
}

const BUILTIN_MODULES = new Set([
  "node:fs", "node:path", "node:url", "node:crypto", "node:child_process",
  "node:os", "node:util", "node:events", "node:stream", "node:http",
  "fs", "path", "url", "crypto", "child_process", "os", "util", "events",
  "stream", "http", "https", "net", "dns", "tls", "readline", "assert",
  "System", "System.Collections", "System.Linq", "System.IO", "System.Threading",
  "os", "sys", "re", "json", "math", "datetime", "collections", "typing",
  "fmt", "io", "strings", "strconv", "net", "os", "sync", "context",
  "std",
]);

function isBuiltinModule(name: string): boolean {
  if (BUILTIN_MODULES.has(name)) return true;
  if (name.startsWith("node:")) return true;
  if (name.startsWith("System.")) return true;
  if (name.startsWith("std.") || name.startsWith("std::")) return true;
  return false;
}

// ── Signal 5: Superseded Functions ──

const SUPERSEDED_SUFFIXES = /(?:V\d+|_v\d+|New|_new|Legacy|_legacy|Old|_old|Deprecated|_deprecated)$/i;

function detectSupersededFunctions(
  graph: DirectedGraph,
  db: Database.Database,
  repoPath: string
): Map<string, number> {
  const results = new Map<string, number>();

  // Build a map of function names for naming-pattern detection
  const nameToIds = new Map<string, string[]>();
  for (const nodeId of graph.nodes()) {
    const attrs = graph.getNodeAttributes(nodeId);
    const name = attrs.functionName as string;
    const ids = nameToIds.get(name) ?? [];
    ids.push(nodeId);
    nameToIds.set(name, ids);
  }

  for (const nodeId of graph.nodes()) {
    const attrs = graph.getNodeAttributes(nodeId);
    const fnName = attrs.functionName as string;
    const filePath = attrs.filePath as string;

    // Check for @deprecated / [Obsolete] annotations
    if (hasDeprecationAnnotation(repoPath, filePath, fnName)) {
      results.set(nodeId, 0.9);
      continue;
    }

    // Check naming patterns: does a "V2" or "New" version exist?
    const suffixMatch = fnName.match(SUPERSEDED_SUFFIXES);
    if (!suffixMatch) {
      // This function might BE the superseder — check if there's an older version
      // e.g., "processPayment" exists and "processPaymentLegacy" also exists
      continue;
    }

    // This function has a legacy/old/deprecated suffix
    const baseName = fnName.replace(SUPERSEDED_SUFFIXES, "");
    if (baseName && nameToIds.has(baseName)) {
      // The base version exists — this suffixed version is either the old one or the new one
      // If suffix is "Legacy"/"Old"/"Deprecated", this IS the old one
      if (/(?:Legacy|_legacy|Old|_old|Deprecated|_deprecated)$/i.test(fnName)) {
        const hasCallers = graph.inDegree(nodeId) > 0;
        results.set(nodeId, hasCallers ? 0.5 : 0.7);
      }
    }

    // Check for "V2" pattern — the function WITHOUT the suffix is the old one
    if (/(?:V\d+|_v\d+|New|_new)$/i.test(fnName)) {
      const oldVersionIds = nameToIds.get(baseName);
      if (oldVersionIds) {
        for (const oldId of oldVersionIds) {
          if (graph.inDegree(oldId) === 0) {
            results.set(oldId, 0.7); // Old version with no callers = superseded
          } else {
            results.set(oldId, 0.3); // Old version still called = partially superseded
          }
        }
      }
    }
  }

  return results;
}

function hasDeprecationAnnotation(
  repoPath: string,
  filePath: string,
  fnName: string
): boolean {
  try {
    const content = readFileSync(resolve(repoPath, filePath), "utf-8");
    const fnIndex = content.indexOf(fnName);
    if (fnIndex === -1) return false;

    // Check the 200 chars before the function name for deprecation markers
    const preamble = content.slice(Math.max(0, fnIndex - 200), fnIndex);
    return /(?:@deprecated|@Deprecated|\[Obsolete\]|#\[deprecated\]|DEPRECATED)/.test(preamble);
  } catch {
    return false;
  }
}

// ── Signal 6: Self-Admitted Aging Debt (SAAD) ──
// Based on SAAD research (2025): 21% of OSS repos have aging debt comments.

const SAAD_PATTERNS = [
  /\bTODO:\s*remove\b/i,
  /\bTODO:\s*delete\b/i,
  /\bTODO:\s*replace\b/i,
  /\bTODO:\s*deprecat/i,
  /\bTODO:\s*migrat/i,
  /\bFIXME:\s*remove\b/i,
  /\bHACK:\s*temporary\b/i,
  /\btemporary\s+(?:until|workaround|fix|solution|hack)\b/i,
  /\blegacy\s+(?:code|compat|support|wrapper|fallback|shim)\b/i,
  /\bbackward[s]?\s+compat/i,
  /\bwill\s+be\s+(?:removed|replaced|deprecated|deleted)/i,
  /\bscheduled\s+for\s+(?:removal|deprecation|deletion)/i,
  /\bno\s+longer\s+(?:needed|required|used|necessary)/i,
  /\bonce\s+.+\s+is\s+(?:ready|done|complete|merged|released)/i,
  /\bkeep\s+(?:for|until)\s+/i,
  /\bretain(?:ed)?\s+for\s+compat/i,
  /\bdead\s+code/i,
  /\bunused\s+(?:but|kept)/i,
  /\b(?:old|previous|former)\s+(?:implementation|approach|version|method)/i,
];

function detectSelfAdmittedDebt(
  db: Database.Database,
  repoPath: string
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

    // Find the function's approximate location and check surrounding comments
    const fnIdx = content.indexOf(chunk.function_name);
    if (fnIdx === -1) continue;

    // Check 500 chars around the function declaration for SAAD patterns
    const context = content.slice(
      Math.max(0, fnIdx - 300),
      Math.min(content.length, fnIdx + 200)
    );

    let matchCount = 0;
    for (const pattern of SAAD_PATTERNS) {
      if (pattern.test(context)) matchCount++;
    }

    if (matchCount > 0) {
      // Scale: 1 match = 0.5, 2+ matches = 0.8, 3+ = 1.0
      results.set(chunk.function_id, Math.min(0.3 + matchCount * 0.35, 1.0));
    }
  }

  return results;
}

// ── Signal 7: Change Burst Absence ──
// Based on Herzig et al. (2010): change bursts predict defects.
// Inverse: function was once part of frequent changes, now completely silent
// while neighboring code is actively changed.

function detectChangeBurstAbsence(
  db: Database.Database,
  repoPath: string
): Map<string, number> {
  const results = new Map<string, number>();
  const now = Date.now();
  const sixMonthsMs = 6 * 30 * 24 * 60 * 60 * 1000;

  // Get per-function activity: total events, events in last 6 months, events 6-24 months ago
  const rows = db
    .prepare(`
      SELECT function_id, file_path,
        COUNT(*) as total_events,
        SUM(CASE WHEN authored_at > datetime('now', '-6 months') THEN 1 ELSE 0 END) as recent_events,
        SUM(CASE WHEN authored_at BETWEEN datetime('now', '-24 months') AND datetime('now', '-6 months') THEN 1 ELSE 0 END) as mid_events,
        MAX(authored_at) as last_active
      FROM decision_events
      WHERE repo_path = ? AND function_id IS NOT NULL
      GROUP BY function_id
    `)
    .all(repoPath) as {
      function_id: string; file_path: string;
      total_events: number; recent_events: number; mid_events: number;
      last_active: string;
    }[];

  // Get per-file recent activity (are neighbors active?)
  const fileActivity = new Map<string, number>();
  const fileRows = db
    .prepare(`
      SELECT file_path, COUNT(*) as recent
      FROM decision_events
      WHERE repo_path = ? AND authored_at > datetime('now', '-6 months')
      GROUP BY file_path
    `)
    .all(repoPath) as { file_path: string; recent: number }[];

  for (const row of fileRows) {
    fileActivity.set(row.file_path, row.recent);
  }

  for (const row of rows) {
    // Skip functions with no significant history
    if (row.total_events < 3) continue;

    // Was once hot (had multiple events in the middle period)
    const wasHot = row.mid_events >= 3;
    // Now silent (zero recent events)
    const nowSilent = row.recent_events === 0;
    // But neighbors are active
    const neighborsActive = (fileActivity.get(row.file_path) ?? 0) > 0;

    if (wasHot && nowSilent && neighborsActive) {
      // Scale by how hot it was: more past activity = stronger signal
      const intensity = Math.min(row.mid_events / 10, 1.0);
      results.set(row.function_id, Math.max(intensity, 0.4));
    } else if (nowSilent && neighborsActive && row.total_events >= 5) {
      // Weaker signal: had some history, now silent, neighbors active
      results.set(row.function_id, 0.3);
    }
  }

  return results;
}

// ── Signal 8: Co-Change Divergence ──
// Based on Tornhill/CodeScene behavioral analysis:
// If a function historically changed with A,B,C but recent changes
// to A,B,C no longer include this function, it's being abandoned.

function detectCoChangeDivergence(
  db: Database.Database,
  repoPath: string
): Map<string, number> {
  const results = new Map<string, number>();

  // Get historical co-change pairs (functions that changed in the same commit)
  const coChangePairs = db
    .prepare(`
      SELECT a.function_id as fn_a, b.function_id as fn_b, COUNT(*) as co_count
      FROM decision_events a
      JOIN decision_events b ON a.commit_sha = b.commit_sha AND a.function_id < b.function_id
      WHERE a.repo_path = ? AND a.function_id IS NOT NULL AND b.function_id IS NOT NULL
      GROUP BY a.function_id, b.function_id
      HAVING co_count >= 3
    `)
    .all(repoPath) as { fn_a: string; fn_b: string; co_count: number }[];

  if (coChangePairs.length === 0) return results;

  // Get recent activity per function (last 6 months)
  const recentlyActive = new Set<string>();
  const recentRows = db
    .prepare(`
      SELECT DISTINCT function_id FROM decision_events
      WHERE repo_path = ? AND function_id IS NOT NULL
        AND authored_at > datetime('now', '-6 months')
    `)
    .all(repoPath) as { function_id: string }[];

  for (const row of recentRows) {
    recentlyActive.add(row.function_id);
  }

  // For each co-change pair: if partner is recently active but this function is not
  const divergenceCount = new Map<string, { total: number; diverged: number }>();

  for (const pair of coChangePairs) {
    for (const [fn, partner] of [[pair.fn_a, pair.fn_b], [pair.fn_b, pair.fn_a]]) {
      const existing = divergenceCount.get(fn) ?? { total: 0, diverged: 0 };
      existing.total++;
      if (recentlyActive.has(partner) && !recentlyActive.has(fn)) {
        existing.diverged++;
      }
      divergenceCount.set(fn, existing);
    }
  }

  for (const [fnId, counts] of divergenceCount) {
    if (counts.total < 2) continue; // Need at least 2 co-change partners
    const divergenceRatio = counts.diverged / counts.total;
    if (divergenceRatio >= 0.5) {
      // More than half of co-change partners are active but this function isn't
      results.set(fnId, Math.min(divergenceRatio, 1.0));
    }
  }

  return results;
}

// ── Utility ──

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
