import {
  DecisionEvent,
  EventType,
  FreezeScore,
  SignalBreakdown,
  IntentConfidence,
} from "./types.js";
import { CATEGORY_WEIGHTS, GIT_SIGNALS } from "./signal-weights.js";
import { getRecoveryLevel } from "./recovery-levels.js";

/**
 * Calculate freeze score for a function by replaying its event stream.
 *
 * Per Kim et al. [8]: "The cache model is dynamic and adapts more quickly
 * to new fault distributions, since fault occurrences directly affect
 * the model." This function replays the full event history to derive
 * the score — never stored, always computed fresh.
 *
 * Phase 1 implements git signals only. Issue, code structure, test,
 * structural, Naur, and Aranda signals are added in later phases.
 */
export function calculateFreezeScore(
  events: DecisionEvent[],
  options?: {
    pagerank?: number;
    issueSignalScore?: number;
    codeStructureScore?: number;
    testSignalScore?: number;
    naurScore?: number;
    arandaScore?: number;
  }
): FreezeScore {
  if (events.length === 0) {
    return emptyScore("", "", "");
  }

  const functionId = events[0].functionId ?? "";
  const filePath = events[0].filePath;
  const functionName = events[0].functionName ?? "";

  const gitScore = calculateGitSignals(events);

  // Phase 1: only git signals are computed from events.
  // Other signals use provided values (default 0).
  const issueScore = options?.issueSignalScore ?? 0;
  const codeStructScore = options?.codeStructureScore ?? 0;
  const testScore = options?.testSignalScore ?? 0;
  const structuralScore = options?.pagerank ?? 0;
  const naurScore = options?.naurScore ?? 0;
  const arandaScore = options?.arandaScore ?? 0;

  const breakdown: SignalBreakdown = {
    gitSignals: gitScore,
    issueSignals: issueScore,
    codeStructure: codeStructScore,
    testSignals: testScore,
    structural: structuralScore,
    naurTheory: naurScore,
    arandaSignals: arandaScore,
  };

  const score = clamp(
    breakdown.gitSignals * CATEGORY_WEIGHTS.gitSignals +
      breakdown.issueSignals * CATEGORY_WEIGHTS.issueSignals +
      breakdown.codeStructure * CATEGORY_WEIGHTS.codeStructure +
      breakdown.testSignals * CATEGORY_WEIGHTS.testSignals +
      breakdown.structural * CATEGORY_WEIGHTS.structural +
      breakdown.naurTheory * CATEGORY_WEIGHTS.naurTheory +
      breakdown.arandaSignals * CATEGORY_WEIGHTS.arandaSignals,
    0,
    1
  );

  return {
    functionId,
    filePath,
    functionName,
    score,
    recoveryLevel: getRecoveryLevel(score),
    signalBreakdown: breakdown,
    theoryGap: false, // Phase 2
    pagerank: options?.pagerank ?? 0,
  };
}

/**
 * Compute the git history signal score (0–1) from events.
 */
function calculateGitSignals(events: DecisionEvent[]): number {
  let score = 0;

  // Revert count
  const revertCount = events.filter(
    (e) =>
      e.eventType === EventType.FUNCTION_CHANGED &&
      e.commitMessage?.toLowerCase().startsWith("revert")
  ).length;
  score += Math.min(revertCount * GIT_SIGNALS.revertCount, 0.45);

  // Commit keywords: verified, tested, stable
  const hasVerifiedKeyword = events.some((e) => {
    const msg = e.commitMessage?.toLowerCase() ?? "";
    return /\b(verified|tested|stable|production)\b/.test(msg);
  });
  if (hasVerifiedKeyword) {
    score += GIT_SIGNALS.commitKeywordsVerified;
  }

  // Production incident reference (#issue in commit message)
  const hasIncidentRef = events.some((e) => {
    const msg = e.commitMessage ?? "";
    return /(#\d+|[A-Z]{2,}-\d+)/.test(msg);
  });
  if (hasIncidentRef) {
    score += GIT_SIGNALS.productionIncidentRef;
  }

  // Contributor count
  const uniqueAuthors = new Set(events.map((e) => e.author).filter(Boolean));
  score += Math.min(
    uniqueAuthors.size * GIT_SIGNALS.contributorCount,
    0.25
  );

  // Age without modification (years stable)
  const sortedByDate = events
    .filter((e) => e.authoredAt)
    .sort(
      (a, b) => (a.authoredAt as Date).getTime() - (b.authoredAt as Date).getTime()
    );
  if (sortedByDate.length > 0) {
    const lastModified = sortedByDate[sortedByDate.length - 1].authoredAt!;
    const yearsStable =
      (Date.now() - lastModified.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
    score += Math.min(
      yearsStable * GIT_SIGNALS.ageWithoutModification,
      0.5
    );
  }

  // Branch type: fix/, hotfix/
  const hasFixBranch = events.some((e) => {
    const meta = e.metadata as Record<string, unknown>;
    const branch = (meta?.branch as string) ?? "";
    return /^(fix|hotfix)\//.test(branch);
  });
  if (hasFixBranch) {
    score += GIT_SIGNALS.branchTypeFix;
  }

  // High confidence intents boost the signal
  const highConfidenceCount = events.filter(
    (e) => e.confidence === IntentConfidence.HIGH
  ).length;
  if (highConfidenceCount > 0) {
    score += Math.min(highConfidenceCount * 0.05, 0.15);
  }

  return clamp(score, 0, 1);
}

function emptyScore(
  functionId: string,
  filePath: string,
  functionName: string
): FreezeScore {
  return {
    functionId,
    filePath,
    functionName,
    score: 0,
    recoveryLevel: getRecoveryLevel(0),
    signalBreakdown: {
      gitSignals: 0,
      issueSignals: 0,
      codeStructure: 0,
      testSignals: 0,
      structural: 0,
      naurTheory: 0,
      arandaSignals: 0,
    },
    theoryGap: false,
    pagerank: 0,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
