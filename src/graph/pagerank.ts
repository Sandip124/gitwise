import { DirectedGraph } from "graphology";
import * as pagerankModule from "graphology-metrics/centrality/pagerank.js";
import { logger } from "../shared/logger.js";

// graphology-metrics CJS compat: module is callable directly
const computePR = (
  typeof pagerankModule === "function"
    ? pagerankModule
    : (pagerankModule as Record<string, unknown>).default ?? pagerankModule
) as (graph: DirectedGraph, options?: Record<string, unknown>) => Record<string, number>;

/**
 * Compute PageRank for all nodes in the call graph.
 *
 * Per Kim et al. [8]: spatial locality — functions with high in-degree
 * (called by many other functions) are more load-bearing.
 * PageRank captures transitive importance, not just direct call count.
 *
 * Returns a map of functionId → pagerank score (0–1 normalized).
 */
export function computePageRank(
  graph: DirectedGraph
): Map<string, number> {
  if (graph.order === 0) {
    return new Map();
  }

  // Compute raw PageRank scores
  const scores = computePR(graph, {
    alpha: 0.85,
    maxIterations: 100,
    tolerance: 1e-6,
  });

  // Normalize to 0–1 range
  let maxScore = 0;
  for (const node of graph.nodes()) {
    const score = scores[node] ?? 0;
    if (score > maxScore) maxScore = score;
  }

  const normalized = new Map<string, number>();
  if (maxScore > 0) {
    for (const node of graph.nodes()) {
      normalized.set(node, (scores[node] ?? 0) / maxScore);
    }
  }

  const topN = [...normalized.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  if (topN.length > 0) {
    logger.info(
      `Top PageRank: ${topN.map(([id, s]) => `${id.split("::function:")[1]}=${s.toFixed(3)}`).join(", ")}`
    );
  }

  return normalized;
}
