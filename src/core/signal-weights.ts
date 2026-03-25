/**
 * Signal weights for freeze score calculation.
 *
 * Academic sources in brackets. See REFERENCE.md for full citations.
 *
 * Combined formula:
 *   freeze_score =
 *     (git_signals     × 0.20)
 *   + (issue_signals   × 0.20)
 *   + (code_structure  × 0.15)
 *   + (test_signals    × 0.15)
 *   + (structural      × 0.15)
 *   + (naur_theory     × 0.10)
 *   + (aranda_signals  × 0.05)
 */

// ── Category weights (must sum to 1.0) ──

export const CATEGORY_WEIGHTS = {
  gitSignals: 0.2,
  issueSignals: 0.2,
  codeStructure: 0.15,
  testSignals: 0.15,
  structural: 0.15,
  naurTheory: 0.1,
  arandaSignals: 0.05,
} as const;

// ── Git History Signals [4][7][8] ──

export const GIT_SIGNALS = {
  revertCount: 0.15, // per revert — Kim [8]: temporal locality
  commitKeywordsVerified: 0.1, // "verified", "tested", "stable" — Aranda [3]
  productionIncidentRef: 0.2, // #issue in commit — Knab [7]
  contributorCount: 0.05, // per author — Aranda [3]
  ageWithoutModification: 0.1, // per year stable — Kim [8]
  branchTypeFix: 0.15, // fix/, hotfix/ — Hericko [4]
} as const;

// ── Issue Enrichment Signals [3][5] ──

export const ISSUE_SIGNALS = {
  wontFixByDesign: 0.35, // Highest weight — Aranda [3]
  reproductionSteps: 0.15, // Aranda [3]: Level 2 evidence
  platformSpecificLabel: 0.1, // Ying [5]: cross-platform surprise
  issueUnreachable: 0.1, // Aranda [3]: absent = protect more
  prReviewComments: 0.15, // Aranda [3]: coordination evidence
} as const;

// ── Code Structure Signals [2][6] ──

export const CODE_STRUCTURE_SIGNALS = {
  inlineComment: 0.2, // Naur [2]: theory leaks into text
  commentKeywords: 0.3, // "intentional", "do not", "hack" — Naur [2]
  magicNumber: 0.15, // Giger [6]: semantic change type
  defensivePattern: 0.1, // Giger [6]: cond changes high-risk
  tryCatchSpecific: 0.1, // Giger [6]: stmt with exception handling
  styleContradiction: 0.15, // Naur [2]: theory-consistent code
} as const;

// ── Test Signals [2][3][4] ──

export const TEST_SIGNALS = {
  dedicatedTest: 0.2, // Naur [2]: written theory evidence
  edgeCaseLabel: 0.25, // Aranda [3]: platform-specific coordination
  testSameCommit: 0.15, // Hericko [4]: intent coherence
} as const;

// ── Structural Importance Signals [6][8] ──

export const STRUCTURAL_SIGNALS = {
  highCallCount: 0.15, // Kim [8]: spatial locality
  publicApiEntry: 0.15, // Giger [6]: func/mDecl high correlation
  authorInactive: 0.2, // Naur [2]: theory dies with team
  stableHighCalls: 0.15, // Kim [8]: changed-entity locality
} as const;

// ── Naur Theory Signals [2] ──

export const NAUR_SIGNALS = {
  globalPattern: 0.25, // Applied across codebase
  intentionalContradiction: 0.3, // Contradicts best practice on purpose
  consistentAcrossFiles: 0.2, // Same pattern in 5+ files
  highRemovalCost: 0.2, // 10+ call sites
} as const;

// ── Aranda Signals [3] ──

export const ARANDA_SIGNALS = {
  forgottenPattern: 0.2, // burst + 12mo silence
  timelineDiscontinuity: 0.15, // events with no electronic trace
  brokenIssueLink: 0.1, // link exists but broken
} as const;

// ── Recovery level thresholds ──

export const RECOVERY_THRESHOLDS = {
  L1: 0.8, // ≥0.8 = Frozen
  L2: 0.5, // 0.5–0.79 = Stable
  // <0.5 = L3 (Active)
} as const;
