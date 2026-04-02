import Database from "better-sqlite3";
import { buildCallGraph } from "../graph/builder.js";
import { computePageRank } from "../graph/pagerank.js";
import { detectTheoryGaps, detectCoChangeSignals } from "../graph/theory-gap.js";
import { computeObsolescencePenalties } from "../graph/obsolescence.js";
import { calibrateWeights, saveCalibration, loadCalibration } from "../core/calibration.js";
import { computeCodeStructureSignals } from "../core/code-structure-analyzer.js";
import { computeTestSignals } from "../core/test-signal-analyzer.js";
import { computeNaurSignals } from "../core/naur-theory-analyzer.js";
import { calculateFreezeScore, FreezeScoreContext } from "../core/freeze-calculator.js";
import { detectChanges, ChangeSet } from "./change-detector.js";
import { EventStore } from "../db/event-store.js";
import { FreezeStore } from "../db/freeze-store.js";
import { logger } from "../shared/logger.js";

export interface RecomputeResult {
  functionsRecomputed: number;
  functionsSkipped: number;
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

  // Step 0: Detect file changes (hash-based, ~1ms per file)
  logger.info("Detecting file changes...");
  let changeSet: ChangeSet | null = null;
  try {
    changeSet = detectChanges(repoPath, db);
    if (!changeSet.rootChanged) {
      logger.info("No file changes detected — skipping recompute");
      return {
        functionsRecomputed: 0,
        functionsSkipped: 0,
        theoryGapsFound: 0,
        obsolescenceDetected: 0,
        graphNodes: 0,
        graphEdges: 0,
        durationMs: Date.now() - startTime,
      };
    }
  } catch (err) {
    logger.warn(`Change detection failed (will recompute all): ${err instanceof Error ? err.message : String(err)}`);
  }

  // Build set of changed file paths for targeted recompute
  const changedFilePaths = changeSet
    ? new Set([...changeSet.changedFiles, ...changeSet.addedFiles, ...changeSet.removedFiles])
    : null; // null = recompute everything

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

  // Step 3.5: Compute the three previously-phantom signal categories
  logger.info("Analyzing code structure signals...");
  const codeStructScores = computeCodeStructureSignals(repoPath, db);
  logger.info(`  Code structure: ${codeStructScores.size} functions with signals`);

  logger.info("Analyzing test signals...");
  const testScores = computeTestSignals(repoPath, db);
  logger.info(`  Test signals: ${testScores.size} functions with test coverage`);

  logger.info("Analyzing Naur theory signals...");
  const naurScores = computeNaurSignals(repoPath, db, graph);
  logger.info(`  Naur theory: ${naurScores.size} functions with theory patterns`);

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

  // Step 5: Recompute freeze scores (incremental: skip unchanged functions)
  const functionIds = eventStore.getDistinctFunctionIds(repoPath);
  const total = functionIds.length;
  let recomputed = 0;
  let skipped = 0;

  logger.info(`Scoring ${total} functions${changedFilePaths ? ` (${changedFilePaths.size} files changed)` : " (full)"}...`);

  for (let i = 0; i < total; i++) {
    const functionId = functionIds[i];
    onProgress?.(i + 1, total);

    // Extract file path from functionId (format: "file:path::function:name")
    const fileMatch = functionId.match(/^file:(.+)::function:/);
    const filePath = fileMatch?.[1];

    // Skip functions in unchanged files (they keep existing scores)
    if (changedFilePaths && filePath && !changedFilePaths.has(filePath)) {
      // Still update if PageRank or obsolescence changed for this function
      const hasNewObsolescence = obsolescencePenalties.has(functionId);
      const hasNewPagerank = pagerankScores.has(functionId);
      if (!hasNewObsolescence && !hasNewPagerank) {
        skipped++;
        continue;
      }
    }

    const events = eventStore.getEventsForFunction(functionId, repoPath);
    if (events.length === 0) continue;

    const ctx: FreezeScoreContext = {
      pagerank: pagerankScores.get(functionId) ?? 0,
      theoryGap: theoryGapSet.has(functionId),
      coChangeScore: coChangeScores.get(functionId) ?? 0,
      codeStructureScore: codeStructScores.get(functionId),
      testSignalScore: testScores.get(functionId),
      naurScore: naurScores.get(functionId),
      obsolescence: obsolescencePenalties.get(functionId),
      branch: currentBranch,
    };

    const score = calculateFreezeScore(events, ctx);
    freezeStore.upsertScore(repoPath, score, currentBranch);
    recomputed++;
  }

  const durationMs = Date.now() - startTime;
  logger.info(
    `Recompute complete: ${recomputed} scored, ${skipped} skipped (unchanged), ` +
    `${theoryGaps.length} theory gaps, ${obsolescencePenalties.size} obsolescence, ` +
    `graph ${graphNodes}/${graphEdges} in ${(durationMs / 1000).toFixed(1)}s`
  );

  return {
    functionsRecomputed: recomputed,
    functionsSkipped: skipped,
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
