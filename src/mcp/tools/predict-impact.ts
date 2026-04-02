import Database from "better-sqlite3";
import { DirectedGraph } from "graphology";

/**
 * Predict what breaks if a function is modified.
 *
 * Uses BFS on the call graph (who calls this function?) with decaying confidence,
 * combined with co-change frequency from commit history. This prevents AI agents
 * from making changes that break callers depending on the old behavior.
 *
 * Impact types:
 * - "direct caller": calls this function directly (certainty)
 * - "transitive caller": calls a direct caller (high probability)
 * - "co-change partner": historically changes with this function (empirical coupling)
 */

interface ImpactedFunction {
  functionName: string;
  filePath: string;
  impactType: "direct caller" | "transitive caller" | "co-change partner";
  confidence: number;  // 0-1
  freezeScore: number;
  reason: string;
}

interface ImpactResult {
  targetFunction: string;
  targetFile: string;
  riskScore: number;       // 0-1: weighted sum of impacted freeze scores
  impacted: ImpactedFunction[];
  formatted: string;
}

export function predictImpact(
  db: Database.Database,
  graph: DirectedGraph | null,
  filePath: string,
  functionName: string,
  repoPath?: string
): ImpactResult {
  const functionId = `file:${filePath}::function:${functionName}`;
  const impacted: ImpactedFunction[] = [];
  const seen = new Set<string>();

  // Load freeze scores for quick lookup
  const freezeMap = new Map<string, { score: number; name: string; file: string }>();
  const scoreRows = db.prepare(
    `SELECT function_id, function_name, file_path, score FROM freeze_scores WHERE repo_path = ?`
  ).all(repoPath ?? "") as { function_id: string; function_name: string; file_path: string; score: number }[];
  for (const r of scoreRows) {
    freezeMap.set(r.function_id, { score: r.score, name: r.function_name, file: r.file_path });
  }

  // 1. Call graph: BFS inward (who calls this function?) with depth-decaying confidence
  if (graph && graph.hasNode(functionId)) {
    const queue: { nodeId: string; depth: number }[] = [];

    // Direct callers (depth 1, confidence 1.0)
    for (const caller of graph.inNeighbors(functionId)) {
      if (caller === functionId) continue;
      queue.push({ nodeId: caller, depth: 1 });
    }

    while (queue.length > 0) {
      const { nodeId, depth } = queue.shift()!;
      if (seen.has(nodeId)) continue;
      seen.add(nodeId);

      const info = freezeMap.get(nodeId);
      const confidence = depth === 1 ? 1.0 : depth === 2 ? 0.6 : 0.3;

      impacted.push({
        functionName: info?.name ?? nodeId.split("::function:")[1] ?? nodeId,
        filePath: info?.file ?? nodeId.split("::function:")[0].replace("file:", ""),
        impactType: depth === 1 ? "direct caller" : "transitive caller",
        confidence,
        freezeScore: info?.score ?? 0,
        reason: depth === 1
          ? `Directly calls ${functionName}()`
          : `Calls a function that calls ${functionName}()`,
      });

      // Continue BFS up to depth 3
      if (depth < 3 && graph.hasNode(nodeId)) {
        for (const upstream of graph.inNeighbors(nodeId)) {
          if (!seen.has(upstream)) {
            queue.push({ nodeId: upstream, depth: depth + 1 });
          }
        }
      }
    }
  }

  // 2. Co-change partners: functions that historically change in the same commit
  const coChangeRows = db.prepare(`
    SELECT b.function_id, COUNT(*) as co_count
    FROM decision_events a
    JOIN decision_events b ON a.commit_sha = b.commit_sha
    WHERE a.function_id = ? AND a.repo_path = ?
      AND b.function_id IS NOT NULL AND b.function_id != a.function_id
    GROUP BY b.function_id
    HAVING co_count >= 3
    ORDER BY co_count DESC
    LIMIT 20
  `).all(functionId, repoPath ?? "") as { function_id: string; co_count: number }[];

  // Get total changes for this function (for frequency ratio)
  const totalChanges = (db.prepare(
    `SELECT COUNT(*) as cnt FROM decision_events WHERE function_id = ? AND repo_path = ?`
  ).get(functionId, repoPath ?? "") as { cnt: number })?.cnt ?? 1;

  for (const row of coChangeRows) {
    if (seen.has(row.function_id)) continue; // Already found via call graph
    seen.add(row.function_id);

    const info = freezeMap.get(row.function_id);
    const frequency = row.co_count / Math.max(totalChanges, 1);

    impacted.push({
      functionName: info?.name ?? row.function_id.split("::function:")[1] ?? "",
      filePath: info?.file ?? "",
      impactType: "co-change partner",
      confidence: Math.min(frequency, 1.0),
      freezeScore: info?.score ?? 0,
      reason: `Changed together ${row.co_count} times (${(frequency * 100).toFixed(0)}% of changes)`,
    });
  }

  // Sort: direct callers first, then by freeze score (high-score impacts are most dangerous)
  impacted.sort((a, b) => {
    if (a.impactType !== b.impactType) {
      const order = { "direct caller": 0, "transitive caller": 1, "co-change partner": 2 };
      return order[a.impactType] - order[b.impactType];
    }
    return b.freezeScore - a.freezeScore;
  });

  // Risk score: weighted sum of impacted freeze scores × confidence
  const riskScore = impacted.length > 0
    ? Math.min(
        impacted.reduce((sum, i) => sum + i.freezeScore * i.confidence, 0) / impacted.length,
        1.0
      )
    : 0;

  const formatted = formatImpact(functionName, filePath, riskScore, impacted);

  return {
    targetFunction: functionName,
    targetFile: filePath,
    riskScore,
    impacted: impacted.slice(0, 20),
    formatted,
  };
}

function formatImpact(
  fnName: string,
  filePath: string,
  riskScore: number,
  impacted: ImpactedFunction[]
): string {
  if (impacted.length === 0) {
    return [
      `Impact analysis: ${fnName}() in ${filePath}`,
      "",
      "No dependents found. This function can be safely modified.",
      "Note: if this function is called via dynamic dispatch, reflection,",
      "or from configuration, the call graph may not capture all callers.",
    ].join("\n");
  }

  const riskLevel = riskScore >= 0.5 ? "HIGH" : riskScore >= 0.2 ? "MODERATE" : "LOW";
  const frozenCallers = impacted.filter(i => i.freezeScore >= 0.8);
  const stableCallers = impacted.filter(i => i.freezeScore >= 0.5 && i.freezeScore < 0.8);
  const directCount = impacted.filter(i => i.impactType === "direct caller").length;
  const coChangeCount = impacted.filter(i => i.impactType === "co-change partner").length;

  const lines = [
    `Impact analysis: ${fnName}()`,
    `Risk: ${riskLevel} (${riskScore.toFixed(2)})`,
    `Blast radius: ${impacted.length} functions (${directCount} direct, ${coChangeCount} co-change)`,
    "\u2501".repeat(50),
  ];

  if (frozenCallers.length > 0) {
    lines.push("");
    lines.push(`\u26a0 ${frozenCallers.length} FROZEN function(s) depend on this:`);
    for (const f of frozenCallers.slice(0, 5)) {
      lines.push(`  \u2718 ${f.functionName}() [${f.freezeScore.toFixed(2)}] — ${f.reason}`);
    }
    lines.push("  Changing the interface or behavior will break verified decisions.");
  }

  if (stableCallers.length > 0) {
    lines.push("");
    lines.push(`\u26a0 ${stableCallers.length} STABLE function(s) depend on this:`);
    for (const f of stableCallers.slice(0, 5)) {
      lines.push(`  ! ${f.functionName}() [${f.freezeScore.toFixed(2)}] — ${f.reason}`);
    }
  }

  const openCallers = impacted.filter(i => i.freezeScore < 0.5).slice(0, 5);
  if (openCallers.length > 0) {
    lines.push("");
    lines.push(`Other dependents:`);
    for (const f of openCallers) {
      lines.push(`  ${f.functionName}() — ${f.reason}`);
    }
  }

  lines.push("");
  lines.push("\u2501".repeat(50));

  if (frozenCallers.length > 0) {
    lines.push("RECOMMENDATION: Do NOT change the function signature or return type.");
    lines.push("Internal refactoring that preserves the interface is safe.");
  } else if (riskScore > 0.2) {
    lines.push("RECOMMENDATION: Preserve the existing interface. Test callers after changes.");
  } else {
    lines.push("Low risk. Proceed with caution for co-change partners.");
  }

  return lines.join("\n");
}
