import {
  DecisionEvent,
  EventType,
  FreezeScore,
  SignalBreakdown,
  IntentConfidence,
} from "./types.js";
import { CATEGORY_WEIGHTS, GIT_SIGNALS } from "./signal-weights.js";
import { getRecoveryLevel } from "./recovery-levels.js";
import { detectCommitOrigin, originScoreModifier, CommitOrigin } from "./commit-origin.js";

export interface FreezeScoreContext {
  pagerank?: number;
  theoryGap?: boolean;
  coChangeScore?: number;
  issueSignalScore?: number;
  codeStructureScore?: number;
  testSignalScore?: number;
  naurScore?: number;
  arandaScore?: number;
  repoPath?: string; // For AI origin detection
}

/**
 * Calculate freeze score for a function by replaying its event stream.
 *
 * Per Kim et al. [8]: "The cache model is dynamic and adapts more quickly
 * to new fault distributions, since fault occurrences directly affect
 * the model." This function replays the full event history to derive
 * the score — never stored, always computed fresh.
 */
export function calculateFreezeScore(
  events: DecisionEvent[],
  ctx?: FreezeScoreContext
): FreezeScore {
  if (events.length === 0) {
    return emptyScore("", "", "");
  }

  const functionId = events[0].functionId ?? "";
  const filePath = events[0].filePath;
  const functionName = events[0].functionName ?? "";

  const gitScore = calculateGitSignals(events, ctx?.repoPath);
  const issueScore = ctx?.issueSignalScore ?? calculateIssueSignals(events);
  const arandaScore = ctx?.arandaScore ?? calculateArandaSignals(events);
  const naurScore = ctx?.naurScore ?? 0;
  const codeStructScore = ctx?.codeStructureScore ?? 0;
  const testScore = ctx?.testSignalScore ?? 0;

  // Structural: combine PageRank + co-change
  const pagerankVal = ctx?.pagerank ?? 0;
  const coChange = ctx?.coChangeScore ?? 0;
  const structuralScore = clamp(pagerankVal * 0.6 + coChange * 0.4, 0, 1);

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
    theoryGap: ctx?.theoryGap ?? false,
    pagerank: pagerankVal,
  };
}

/**
 * Compute the git history signal score (0–1) from events.
 * Scores are weighted by commit origin — AI-unreviewed commits
 * carry less theory weight than human or human-reviewed commits.
 */
function calculateGitSignals(events: DecisionEvent[], repoPath?: string): number {
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
      (a, b) =>
        (a.authoredAt as Date).getTime() - (b.authoredAt as Date).getTime()
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

  // Apply AI origin modifier — AI-unreviewed commits carry less theory weight
  if (repoPath) {
    let totalModifier = 0;
    let modifierCount = 0;
    for (const e of events) {
      if (e.author) {
        const origin = detectCommitOrigin(e.author, repoPath, e.commitMessage ?? undefined);
        totalModifier += originScoreModifier(origin);
        modifierCount++;
      }
    }
    if (modifierCount > 0) {
      const avgModifier = totalModifier / modifierCount;
      score *= avgModifier;
    }
  }

  return clamp(score, 0, 1);
}

/**
 * Compute issue enrichment signal score (0–1) from ISSUE_ENRICHED events.
 * Per Aranda & Venolia [3] and Aryani et al. [9].
 */
function calculateIssueSignals(events: DecisionEvent[]): number {
  const issueEvents = events.filter(
    (e) => e.eventType === EventType.ISSUE_ENRICHED
  );
  if (issueEvents.length === 0) return 0;

  let score = 0;
  for (const event of issueEvents) {
    const meta = event.metadata as Record<string, unknown>;
    const boost = (meta?.freezeBoost as number) ?? 0;
    score += boost;
  }
  return clamp(score, 0, 1);
}

/**
 * Compute Aranda signals (0–1) from event timeline patterns.
 *
 * Per Aranda & Venolia [3]:
 * - "Forgotten" pattern: burst of activity + 12mo silence
 * - Timeline discontinuity: large gaps with no events
 * - Broken issue links (detected via ISSUE_UNREACHABLE metadata)
 */
function calculateArandaSignals(events: DecisionEvent[]): number {
  if (events.length < 2) return 0;

  let score = 0;

  // Sort events by date
  const dated = events
    .filter((e) => e.authoredAt)
    .sort(
      (a, b) =>
        (a.authoredAt as Date).getTime() - (b.authoredAt as Date).getTime()
    );

  if (dated.length < 2) return 0;

  // "Forgotten" pattern: had activity but nothing for 12+ months
  const lastEvent = dated[dated.length - 1].authoredAt!;
  const monthsSinceLastEvent =
    (Date.now() - lastEvent.getTime()) / (30 * 24 * 60 * 60 * 1000);

  if (dated.length >= 3 && monthsSinceLastEvent > 12) {
    score += 0.2; // forgottenPattern weight
  }

  // Timeline discontinuity: any gap > 12 months between events
  for (let i = 1; i < dated.length; i++) {
    const gap =
      ((dated[i].authoredAt as Date).getTime() -
        (dated[i - 1].authoredAt as Date).getTime()) /
      (30 * 24 * 60 * 60 * 1000);
    if (gap > 12) {
      score += 0.15; // timelineDiscontinuity weight
      break;
    }
  }

  // Broken issue links (from issue enrichment metadata)
  const hasBrokenLink = events.some((e) => {
    const meta = e.metadata as Record<string, unknown>;
    return meta?.issueStatus === "unreachable";
  });
  if (hasBrokenLink) {
    score += 0.1; // brokenIssueLink weight
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
