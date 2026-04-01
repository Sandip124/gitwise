import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { ObsolescenceBreakdown } from "./types.js";
import {
  OBSOLESCENCE_WEIGHTS,
  MAX_OBSOLESCENCE_PENALTY,
} from "./signal-weights.js";
import { logger } from "../shared/logger.js";

// ── Types ──

export interface CalibratedWeights {
  deadCode: number;
  staleSubgraph: number;
  migrationLeftover: number;
  obsoleteDependency: number;
  supersededFunction: number;
  selfAdmittedDebt: number;
  changeBurstAbsence: number;
  coChangeDivergence: number;
}

export interface CalibrationResult {
  weights: CalibratedWeights;
  entropy: Record<string, number>;
  correlations: Record<string, number>;
  bayesianAdjustments: Record<string, number>;
  confidence: number;           // 0-1: how reliable the calibration is
  feedbackEvents: number;
  method: "entropy" | "entropy+bayesian" | "defaults";
}

const SIGNAL_NAMES = [
  "deadCode", "staleSubgraph", "migrationLeftover",
  "obsoleteDependency", "supersededFunction",
  "selfAdmittedDebt", "changeBurstAbsence", "coChangeDivergence",
] as const;

type SignalName = typeof SIGNAL_NAMES[number];

const DEFAULT_WEIGHTS: CalibratedWeights = {
  deadCode: 0.30,
  staleSubgraph: 0.20,
  migrationLeftover: 0.25,
  obsoleteDependency: 0.15,
  supersededFunction: 0.10,
  selfAdmittedDebt: 0.20,
  changeBurstAbsence: 0.15,
  coChangeDivergence: 0.15,
};

// Floor/ceiling to prevent pathological calibrations
const WEIGHT_FLOOR = 0.05;
const WEIGHT_CEILING = 0.45;
const MIN_FUNCTIONS_FOR_CALIBRATION = 20;

// ── Phase 1: Entropy-Based Calibration ──

/**
 * Compute calibrated weights from the distribution of signal values
 * across all functions in the repository.
 *
 * Based on: "Weighted Software Metrics Aggregation" (Springer, 2021).
 * Signals with low entropy (same value for most functions) get lower weight.
 * Signals highly correlated with others share weight instead of stacking.
 */
export function calibrateWeights(
  signalMaps: Map<string, Record<SignalName, number>>,
  db?: Database.Database,
  repoPath?: string
): CalibrationResult {
  const functions = [...signalMaps.values()];

  // Not enough data — use defaults
  if (functions.length < MIN_FUNCTIONS_FOR_CALIBRATION) {
    return {
      weights: DEFAULT_WEIGHTS,
      entropy: {},
      correlations: {},
      bayesianAdjustments: {},
      confidence: 0,
      feedbackEvents: 0,
      method: "defaults",
    };
  }

  // Step 1: Compute entropy per signal
  const entropy: Record<string, number> = {};
  for (const signal of SIGNAL_NAMES) {
    const values = functions.map(f => f[signal] ?? 0);
    entropy[signal] = shannonEntropy(values);
  }

  // Step 2: Compute pairwise correlation matrix
  const correlations: Record<string, number> = {};
  const avgCorrelation: Record<string, number> = {};

  for (const s1 of SIGNAL_NAMES) {
    let totalCorr = 0;
    let count = 0;
    for (const s2 of SIGNAL_NAMES) {
      if (s1 === s2) continue;
      const key = [s1, s2].sort().join(":");
      if (!(key in correlations)) {
        const v1 = functions.map(f => f[s1] ?? 0);
        const v2 = functions.map(f => f[s2] ?? 0);
        correlations[key] = pearsonCorrelation(v1, v2);
      }
      totalCorr += Math.abs(correlations[key]);
      count++;
    }
    avgCorrelation[s1] = count > 0 ? totalCorr / count : 0;
  }

  // Step 3: Compute raw weights = entropy × (1 - avg_correlation)
  const rawWeights: Record<string, number> = {};
  let totalRaw = 0;
  for (const signal of SIGNAL_NAMES) {
    const e = entropy[signal] ?? 0;
    const c = avgCorrelation[signal] ?? 0;
    rawWeights[signal] = e * (1 - c);
    totalRaw += rawWeights[signal];
  }

  // Step 4: Normalize to sum to 1.0, then scale to DEFAULT total weight
  const defaultTotal = Object.values(DEFAULT_WEIGHTS).reduce((s, v) => s + v, 0);
  const weights: CalibratedWeights = { ...DEFAULT_WEIGHTS };

  if (totalRaw > 0) {
    for (const signal of SIGNAL_NAMES) {
      const normalized = (rawWeights[signal] / totalRaw) * defaultTotal;
      weights[signal] = clamp(normalized, WEIGHT_FLOOR, WEIGHT_CEILING);
    }
  }

  // Step 5: Apply Bayesian adjustments if we have feedback
  let bayesianAdjustments: Record<string, number> = {};
  let feedbackEvents = 0;

  if (db && repoPath) {
    const bayesian = computeBayesianAdjustments(db, repoPath);
    bayesianAdjustments = bayesian.adjustments;
    feedbackEvents = bayesian.totalEvents;

    if (feedbackEvents > 0) {
      for (const signal of SIGNAL_NAMES) {
        const adj = bayesianAdjustments[signal] ?? 0;
        weights[signal] = clamp(weights[signal] * (1 + adj), WEIGHT_FLOOR, WEIGHT_CEILING);
      }
    }
  }

  // Confidence: scales with data quantity and feedback
  const dataConfidence = Math.min(functions.length / 100, 1.0);
  const feedbackConfidence = Math.min(feedbackEvents / 10, 1.0);
  const confidence = dataConfidence * 0.7 + feedbackConfidence * 0.3;

  const method = feedbackEvents > 0 ? "entropy+bayesian" : "entropy";

  logger.info(
    `Calibration (${method}): confidence ${(confidence * 100).toFixed(0)}%, ` +
    `${functions.length} functions, ${feedbackEvents} feedback events`
  );

  return {
    weights,
    entropy,
    correlations,
    bayesianAdjustments,
    confidence,
    feedbackEvents,
    method,
  };
}

// ── Phase 2: Bayesian Updating ──

/**
 * Record feedback when a user overrides or deletes an obsolescence-penalized function.
 */
export function recordCalibrationFeedback(
  db: Database.Database,
  repoPath: string,
  functionId: string,
  feedbackType: "FALSE_POSITIVE" | "TRUE_POSITIVE" | "TRUE_NEGATIVE",
  signalValues: Record<string, number>
): void {
  db.prepare(
    `INSERT INTO calibration_feedback
     (id, repo_path, function_id, feedback_type, signal_values)
     VALUES (?, ?, ?, ?, ?)`
  ).run(
    randomUUID(),
    repoPath,
    functionId,
    feedbackType,
    JSON.stringify(signalValues)
  );
}

/**
 * Compute Bayesian adjustments from accumulated feedback.
 *
 * FALSE_POSITIVE (override on penalized function) → decrease that signal's weight
 * TRUE_POSITIVE (function deleted that had penalty) → increase that signal's weight
 */
function computeBayesianAdjustments(
  db: Database.Database,
  repoPath: string
): { adjustments: Record<string, number>; totalEvents: number } {
  const adjustments: Record<string, number> = {};

  let rows: { feedback_type: string; signal_values: string }[];
  try {
    rows = db.prepare(
      `SELECT feedback_type, signal_values FROM calibration_feedback WHERE repo_path = ?`
    ).all(repoPath) as { feedback_type: string; signal_values: string }[];
  } catch {
    return { adjustments, totalEvents: 0 };
  }

  if (rows.length === 0) return { adjustments, totalEvents: 0 };

  // Accumulate signal-level adjustments
  const signalHits: Record<string, { positive: number; negative: number }> = {};
  for (const signal of SIGNAL_NAMES) {
    signalHits[signal] = { positive: 0, negative: 0 };
  }

  for (const row of rows) {
    let signals: Record<string, number>;
    try {
      signals = JSON.parse(row.signal_values);
    } catch { continue; }

    for (const signal of SIGNAL_NAMES) {
      if ((signals[signal] ?? 0) > 0) {
        if (row.feedback_type === "FALSE_POSITIVE") {
          signalHits[signal].negative++;
        } else if (row.feedback_type === "TRUE_POSITIVE") {
          signalHits[signal].positive++;
        }
      }
    }
  }

  // Convert hits to adjustment factors
  // Positive surplus → increase weight (+), negative surplus → decrease weight (-)
  for (const signal of SIGNAL_NAMES) {
    const { positive, negative } = signalHits[signal];
    const total = positive + negative;
    if (total === 0) continue;

    // Adjustment range: -0.5 to +0.5 (never more than ±50% shift)
    const ratio = (positive - negative) / total;
    adjustments[signal] = ratio * 0.5;
  }

  return { adjustments, totalEvents: rows.length };
}

// ── Phase 3: Save/Load/Validate ──

export function saveCalibration(
  db: Database.Database,
  repoPath: string,
  result: CalibrationResult
): void {
  db.prepare(
    `INSERT INTO repo_calibration
     (repo_path, calibrated_weights, entropy_scores, correlation_matrix,
      bayesian_adjustments, feedback_events, last_calibrated, confidence)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'), ?)
     ON CONFLICT (repo_path) DO UPDATE SET
       calibrated_weights = excluded.calibrated_weights,
       entropy_scores = excluded.entropy_scores,
       correlation_matrix = excluded.correlation_matrix,
       bayesian_adjustments = excluded.bayesian_adjustments,
       feedback_events = excluded.feedback_events,
       last_calibrated = datetime('now'),
       confidence = excluded.confidence`
  ).run(
    repoPath,
    JSON.stringify(result.weights),
    JSON.stringify(result.entropy),
    JSON.stringify(result.correlations),
    JSON.stringify(result.bayesianAdjustments),
    result.feedbackEvents,
    result.confidence
  );
}

export function loadCalibration(
  db: Database.Database,
  repoPath: string
): CalibrationResult | null {
  let row: Record<string, unknown> | undefined;
  try {
    row = db.prepare(
      `SELECT * FROM repo_calibration WHERE repo_path = ?`
    ).get(repoPath) as Record<string, unknown> | undefined;
  } catch {
    return null;
  }

  if (!row) return null;

  try {
    return {
      weights: JSON.parse(row.calibrated_weights as string),
      entropy: JSON.parse(row.entropy_scores as string),
      correlations: JSON.parse(row.correlation_matrix as string),
      bayesianAdjustments: JSON.parse(row.bayesian_adjustments as string),
      confidence: row.confidence as number,
      feedbackEvents: row.feedback_events as number,
      method: (row.feedback_events as number) > 0 ? "entropy+bayesian" : "entropy",
    };
  } catch {
    return null;
  }
}

/**
 * Format calibration for display (wisegit calibrate --validate).
 */
export function formatCalibrationReport(result: CalibrationResult): string {
  const lines: string[] = [
    "Obsolescence Weight Calibration Report",
    "═".repeat(50),
    "",
    `Method:     ${result.method}`,
    `Confidence: ${(result.confidence * 100).toFixed(0)}%`,
    `Feedback:   ${result.feedbackEvents} events`,
    "",
    "Calibrated Weights (vs defaults):",
    "─".repeat(50),
  ];

  for (const signal of SIGNAL_NAMES) {
    const calibrated = result.weights[signal as keyof CalibratedWeights] ?? 0;
    const defaultVal = DEFAULT_WEIGHTS[signal as keyof CalibratedWeights] ?? 0;
    const diff = calibrated - defaultVal;
    const diffStr = diff > 0 ? `+${(diff * 100).toFixed(1)}%` : `${(diff * 100).toFixed(1)}%`;
    const bar = "█".repeat(Math.round(calibrated * 20));
    const entropyVal = result.entropy[signal] ?? 0;

    lines.push(
      `  ${padRight(signal, 24)} ${bar.padEnd(10)} ${(calibrated * 100).toFixed(1).padStart(5)}%  (${diffStr.padStart(7)})  entropy: ${entropyVal.toFixed(3)}`
    );
  }

  if (Object.keys(result.bayesianAdjustments).length > 0) {
    lines.push("");
    lines.push("Bayesian Adjustments (from feedback):");
    lines.push("─".repeat(50));
    for (const [signal, adj] of Object.entries(result.bayesianAdjustments)) {
      if (Math.abs(adj) < 0.001) continue;
      const direction = adj > 0 ? "↑ increase" : "↓ decrease";
      lines.push(`  ${padRight(signal, 24)} ${direction} by ${(Math.abs(adj) * 100).toFixed(1)}%`);
    }
  }

  if (Object.keys(result.correlations).length > 0) {
    lines.push("");
    lines.push("Signal Correlations (top 5):");
    lines.push("─".repeat(50));
    const sorted = Object.entries(result.correlations)
      .sort(([, a], [, b]) => Math.abs(b) - Math.abs(a))
      .slice(0, 5);
    for (const [pair, corr] of sorted) {
      const [s1, s2] = pair.split(":");
      const strength = Math.abs(corr) > 0.7 ? "strong" : Math.abs(corr) > 0.3 ? "moderate" : "weak";
      lines.push(`  ${padRight(`${s1} ↔ ${s2}`, 40)} ${corr.toFixed(3)}  (${strength})`);
    }
  }

  lines.push("");
  lines.push("═".repeat(50));

  return lines.join("\n");
}

// ── Math Utilities ──

function shannonEntropy(values: number[]): number {
  if (values.length === 0) return 0;

  // Bin continuous values into 10 buckets
  const bins = 10;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;

  if (range === 0) return 0; // All same value = zero entropy

  const counts = new Array(bins).fill(0);
  for (const v of values) {
    const bin = Math.min(Math.floor(((v - min) / range) * bins), bins - 1);
    counts[bin]++;
  }

  let entropy = 0;
  const total = values.length;
  for (const count of counts) {
    if (count === 0) continue;
    const p = count / total;
    entropy -= p * Math.log2(p);
  }

  // Normalize to [0, 1] where log2(bins) is max entropy
  return entropy / Math.log2(bins);
}

function pearsonCorrelation(x: number[], y: number[]): number {
  const n = x.length;
  if (n === 0) return 0;

  const meanX = x.reduce((s, v) => s + v, 0) / n;
  const meanY = y.reduce((s, v) => s + v, 0) / n;

  let sumXY = 0, sumX2 = 0, sumY2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;
    sumXY += dx * dy;
    sumX2 += dx * dx;
    sumY2 += dy * dy;
  }

  const denom = Math.sqrt(sumX2 * sumY2);
  return denom === 0 ? 0 : sumXY / denom;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function padRight(s: string, len: number): string {
  return s.length >= len ? s : s + " ".repeat(len - s.length);
}
