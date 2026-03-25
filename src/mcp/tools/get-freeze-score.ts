import pg from "pg";
import { EventStore } from "../../db/event-store.js";
import { FreezeStore } from "../../db/freeze-store.js";
import { calculateFreezeScore } from "../../core/freeze-calculator.js";
import { getFreezeStatus } from "../../core/recovery-levels.js";
import { makeFunctionId, FreezeScore } from "../../core/types.js";

export interface FreezeScoreResult {
  functionId: string;
  functionName: string;
  filePath: string;
  score: number;
  recoveryLevel: string;
  status: string;
  signalBreakdown: Record<string, number>;
  theoryGap: boolean;
  eventCount: number;
  formatted: string;
}

/**
 * Get freeze score + signal breakdown for a specific function.
 */
export async function getFreezeScoreForFunction(
  pool: pg.Pool,
  filePath: string,
  functionName: string,
  repoPath?: string
): Promise<FreezeScoreResult> {
  const eventStore = new EventStore(pool);
  const freezeStore = new FreezeStore(pool);

  const functionId = makeFunctionId(filePath, functionName);

  // Try cached score first
  let score: FreezeScore | null = await freezeStore.getScore(functionId);

  // If not cached, compute from events
  if (!score) {
    const events = await eventStore.getEventsForFunction(functionId, repoPath);
    if (events.length === 0) {
      return {
        functionId,
        functionName,
        filePath,
        score: 0,
        recoveryLevel: "L3",
        status: "OPEN",
        signalBreakdown: {},
        theoryGap: false,
        eventCount: 0,
        formatted: `${functionName}() — no history tracked. Score: 0.00 (OPEN)`,
      };
    }
    score = calculateFreezeScore(events);
  }

  const events = await eventStore.getEventsForFunction(functionId, repoPath);
  const status = getFreezeStatus(score.recoveryLevel);

  const formatted = [
    `${functionName}()  [score: ${score.score.toFixed(2)}] [${status}] [Recovery: ${score.recoveryLevel}]`,
    "",
    "Signal Breakdown:",
    `  Git History:     ${score.signalBreakdown.gitSignals.toFixed(3)} × 0.20 = ${(score.signalBreakdown.gitSignals * 0.2).toFixed(3)}`,
    `  Issue Signals:   ${score.signalBreakdown.issueSignals.toFixed(3)} × 0.20 = ${(score.signalBreakdown.issueSignals * 0.2).toFixed(3)}`,
    `  Code Structure:  ${score.signalBreakdown.codeStructure.toFixed(3)} × 0.15 = ${(score.signalBreakdown.codeStructure * 0.15).toFixed(3)}`,
    `  Test Signals:    ${score.signalBreakdown.testSignals.toFixed(3)} × 0.15 = ${(score.signalBreakdown.testSignals * 0.15).toFixed(3)}`,
    `  Structural:      ${score.signalBreakdown.structural.toFixed(3)} × 0.15 = ${(score.signalBreakdown.structural * 0.15).toFixed(3)}`,
    `  Naur Theory:     ${score.signalBreakdown.naurTheory.toFixed(3)} × 0.10 = ${(score.signalBreakdown.naurTheory * 0.1).toFixed(3)}`,
    `  Aranda Signals:  ${score.signalBreakdown.arandaSignals.toFixed(3)} × 0.05 = ${(score.signalBreakdown.arandaSignals * 0.05).toFixed(3)}`,
    "",
    `Theory Gap: ${score.theoryGap ? "YES" : "No"}`,
    `Events tracked: ${events.length}`,
  ].join("\n");

  return {
    functionId,
    functionName,
    filePath,
    score: score.score,
    recoveryLevel: score.recoveryLevel,
    status,
    signalBreakdown: score.signalBreakdown as unknown as Record<string, number>,
    theoryGap: score.theoryGap,
    eventCount: events.length,
    formatted,
  };
}
