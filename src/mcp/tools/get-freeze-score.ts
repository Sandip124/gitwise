import Database from "better-sqlite3";
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

export function getFreezeScoreForFunction(
  db: Database.Database,
  filePath: string,
  functionName: string,
  repoPath?: string
): FreezeScoreResult {
  const eventStore = new EventStore(db);
  const freezeStore = new FreezeStore(db);

  const functionId = makeFunctionId(filePath, functionName);

  let score: FreezeScore | null = freezeStore.getScore(functionId);

  if (!score) {
    const events = eventStore.getEventsForFunction(functionId, repoPath);
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
        formatted: `${functionName}() \u2014 no history tracked. Score: 0.00 (OPEN)`,
      };
    }
    score = calculateFreezeScore(events);
  }

  const events = eventStore.getEventsForFunction(functionId, repoPath);
  const status = getFreezeStatus(score.recoveryLevel);

  const lines = [
    `${functionName}()  [score: ${score.score.toFixed(2)}] [${status}] [Recovery: ${score.recoveryLevel}]`,
    "",
    "Signal Breakdown (protection):",
    `  Git History:     ${score.signalBreakdown.gitSignals.toFixed(3)} \u00d7 0.20 = ${(score.signalBreakdown.gitSignals * 0.2).toFixed(3)}`,
    `  Issue Signals:   ${score.signalBreakdown.issueSignals.toFixed(3)} \u00d7 0.20 = ${(score.signalBreakdown.issueSignals * 0.2).toFixed(3)}`,
    `  Code Structure:  ${score.signalBreakdown.codeStructure.toFixed(3)} \u00d7 0.15 = ${(score.signalBreakdown.codeStructure * 0.15).toFixed(3)}`,
    `  Test Signals:    ${score.signalBreakdown.testSignals.toFixed(3)} \u00d7 0.15 = ${(score.signalBreakdown.testSignals * 0.15).toFixed(3)}`,
    `  Structural:      ${score.signalBreakdown.structural.toFixed(3)} \u00d7 0.15 = ${(score.signalBreakdown.structural * 0.15).toFixed(3)}`,
    `  Naur Theory:     ${score.signalBreakdown.naurTheory.toFixed(3)} \u00d7 0.10 = ${(score.signalBreakdown.naurTheory * 0.1).toFixed(3)}`,
    `  Aranda Signals:  ${score.signalBreakdown.arandaSignals.toFixed(3)} \u00d7 0.05 = ${(score.signalBreakdown.arandaSignals * 0.05).toFixed(3)}`,
  ];

  if (score.obsolescence && score.obsolescence.penalty > 0) {
    const obs = score.obsolescence;
    lines.push("");
    lines.push(`Obsolescence Penalty: -${(obs.penalty * 100).toFixed(0)}%${score.baseScore ? ` (base score: ${score.baseScore.toFixed(2)})` : ""}`);
    if (obs.deadCode > 0) lines.push(`  Dead code (no callers):       ${obs.deadCode.toFixed(2)}`);
    if (obs.staleSubgraph > 0) lines.push(`  Stale subgraph:               ${obs.staleSubgraph.toFixed(2)}`);
    if (obs.migrationLeftover > 0) lines.push(`  Migration leftover:           ${obs.migrationLeftover.toFixed(2)}`);
    if (obs.obsoleteDependency > 0) lines.push(`  Obsolete dependency:          ${obs.obsoleteDependency.toFixed(2)}`);
    if (obs.supersededFunction > 0) lines.push(`  Superseded function:          ${obs.supersededFunction.toFixed(2)}`);
    if (obs.selfAdmittedDebt > 0) lines.push(`  Self-admitted aging debt:      ${obs.selfAdmittedDebt.toFixed(2)}`);
    if (obs.changeBurstAbsence > 0) lines.push(`  Change burst absence:         ${obs.changeBurstAbsence.toFixed(2)}`);
    if (obs.coChangeDivergence > 0) lines.push(`  Co-change divergence:         ${obs.coChangeDivergence.toFixed(2)}`);
  }

  lines.push("");
  lines.push(`Theory Gap: ${score.theoryGap ? "YES" : "No"}`);
  lines.push(`Events tracked: ${events.length}`);

  const formatted = lines.join("\n");

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
