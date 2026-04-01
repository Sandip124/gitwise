import Database from "better-sqlite3";
import { buildCallGraph } from "../graph/builder.js";
import { computePageRank } from "../graph/pagerank.js";
import { detectTheoryGaps, detectCoChangeSignals } from "../graph/theory-gap.js";
import { computeObsolescencePenalties } from "../graph/obsolescence.js";
import { calibrateWeights, saveCalibration, loadCalibration } from "../core/calibration.js";
import { calculateFreezeScore, FreezeScoreContext } from "../core/freeze-calculator.js";
import { EventStore } from "../db/event-store.js";
import { FreezeStore } from "../db/freeze-store.js";
import { logger } from "../shared/logger.js";

export interface RecomputeResult {
  functionsRecomputed: number;
  theoryGapsFound: number;
  obsolescenceDetected: number;
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
  onProgress?: (current: number, total: number) => void,
  branch?: string
): Promise<RecomputeResult> {
  const startTime = Date.now();
  const eventStore = new EventStore(db);
  const freezeStore = new FreezeStore(db);
  const currentBranch = branch ?? detectCurrentBranch(repoPath);

  // Step 1: Build call graph + PageRank
  logger.info("Building call graph...");
  let graph: import("graphology").DirectedGraph | null = null;
  let pagerankScores = new Map<string, number>();
  let graphNodes = 0;
  let graphEdges = 0;

  try {
    graph = await buildCallGraph(repoPath, db);
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

  // Step 4: Compute obsolescence penalties with adaptive calibration
  logger.info(`Computing obsolescence signals for branch '${currentBranch}'...`);
  let obsolescencePenalties = new Map<string, import("../core/types.js").ObsolescenceBreakdown>();

  if (graph) {
    try {
      // Pass 1: Compute raw signals (no calibration yet)
      const { penalties: rawPenalties, signalMaps } = computeObsolescencePenalties({
        repoPath,
        db,
        graph,
        branch: currentBranch,
      });

      // Pass 2: Calibrate weights from signal distribution
      if (signalMaps.size > 0) {
        const calibration = calibrateWeights(signalMaps, db, repoPath);

        if (calibration.method !== "defaults") {
          // Re-compute with calibrated weights
          logger.info(`Using ${calibration.method} calibration (confidence: ${(calibration.confidence * 100).toFixed(0)}%)`);
          const { penalties: calibratedPenalties } = computeObsolescencePenalties({
            repoPath,
            db,
            graph,
            branch: currentBranch,
            calibratedWeights: calibration.weights,
          });
          obsolescencePenalties = calibratedPenalties;
        } else {
          obsolescencePenalties = rawPenalties;
        }

        // Save calibration for inspection via `wisegit calibrate --validate`
        try {
          saveCalibration(db, repoPath, calibration);
        } catch {
          // Non-critical — calibration table might not exist yet
        }
      } else {
        obsolescencePenalties = rawPenalties;
      }
    } catch (err) {
      logger.warn(
        `Obsolescence detection failed (continuing without): ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  // Step 5: Recompute all freeze scores
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
      obsolescence: obsolescencePenalties.get(functionId),
      branch: currentBranch,
    };

    const score = calculateFreezeScore(events, ctx);
    freezeStore.upsertScore(repoPath, score, currentBranch);
  }

  const durationMs = Date.now() - startTime;
  logger.info(
    `Recompute complete: ${recomputed} functions, ${theoryGaps.length} theory gaps, ${obsolescencePenalties.size} obsolescence signals, graph ${graphNodes} nodes / ${graphEdges} edges in ${(durationMs / 1000).toFixed(1)}s`
  );

  return {
    functionsRecomputed: recomputed,
    theoryGapsFound: theoryGaps.length,
    obsolescenceDetected: obsolescencePenalties.size,
    graphNodes,
    graphEdges,
    durationMs,
  };
}

function detectCurrentBranch(repoPath: string): string {
  try {
    const { execFileSync } = require("node:child_process");
    return execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: repoPath,
      encoding: "utf-8",
    }).trim();
  } catch {
    return "HEAD";
  }
}
