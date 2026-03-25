import Database from "better-sqlite3";
import { buildCallGraph } from "../graph/builder.js";
import { computePageRank } from "../graph/pagerank.js";
import { detectTheoryGaps, detectCoChangeSignals } from "../graph/theory-gap.js";
import { calculateFreezeScore, FreezeScoreContext } from "../core/freeze-calculator.js";
import { EventStore } from "../db/event-store.js";
import { FreezeStore } from "../db/freeze-store.js";
import { logger } from "../shared/logger.js";

export interface RecomputeResult {
  functionsRecomputed: number;
  theoryGapsFound: number;
  graphNodes: number;
  graphEdges: number;
  durationMs: number;
}

/**
 * Recompute all freeze scores with full Phase 2 signals:
 * - PageRank from call graph (structural importance)
 * - Theory gap detection (Naur death, timeline discontinuities, forgotten patterns)
 * - Co-change signals (files frequently changed together)
 * - Aranda signals (computed from event timeline)
 */
export async function runRecomputePipeline(
  repoPath: string,
  db: Database.Database,
  onProgress?: (current: number, total: number) => void
): Promise<RecomputeResult> {
  const startTime = Date.now();
  const eventStore = new EventStore(db);
  const freezeStore = new FreezeStore(db);

  // Step 1: Build call graph + PageRank
  logger.info("Building call graph...");
  let pagerankScores = new Map<string, number>();
  let graphNodes = 0;
  let graphEdges = 0;

  try {
    const graph = await buildCallGraph(repoPath, db);
    graphNodes = graph.order;
    graphEdges = graph.size;
    pagerankScores = computePageRank(graph);
  } catch (err) {
    logger.warn(
      `Call graph build failed (continuing without PageRank): ${err instanceof Error ? err.message : String(err)}`
    );
  }

  // Step 2: Detect theory gaps
  logger.info("Detecting theory gaps...");
  const theoryGaps = detectTheoryGaps(repoPath, db);
  const theoryGapSet = new Set(theoryGaps.map((g) => g.functionId));

  // Step 3: Detect co-change signals
  logger.info("Computing co-change signals...");
  const coChangeScores = detectCoChangeSignals(repoPath, db);

  // Step 4: Recompute all freeze scores
  const functionIds = eventStore.getDistinctFunctionIds(repoPath);
  logger.info(`Recomputing ${functionIds.length} freeze scores with full signals...`);

  let recomputed = 0;

  for (const functionId of functionIds) {
    recomputed++;
    onProgress?.(recomputed, functionIds.length);

    const events = eventStore.getEventsForFunction(functionId, repoPath);
    if (events.length === 0) continue;

    const ctx: FreezeScoreContext = {
      pagerank: pagerankScores.get(functionId) ?? 0,
      theoryGap: theoryGapSet.has(functionId),
      coChangeScore: coChangeScores.get(functionId) ?? 0,
    };

    const score = calculateFreezeScore(events, ctx);
    freezeStore.upsertScore(repoPath, score);
  }

  const durationMs = Date.now() - startTime;
  logger.info(
    `Recompute complete: ${recomputed} functions, ${theoryGaps.length} theory gaps, graph ${graphNodes} nodes / ${graphEdges} edges in ${(durationMs / 1000).toFixed(1)}s`
  );

  return {
    functionsRecomputed: recomputed,
    theoryGapsFound: theoryGaps.length,
    graphNodes,
    graphEdges,
    durationMs,
  };
}
