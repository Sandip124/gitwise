import { RecoveryLevel } from "./types.js";
import { RECOVERY_THRESHOLDS } from "./signal-weights.js";

/**
 * Determine recovery level from freeze score.
 *
 * - L1 (≥0.8): Frozen — modify only with override and mandatory reason
 * - L2 (0.5–0.79): Stable — proceed with caution, review intent history first
 * - L3 (<0.5): Active — no restrictions, normal development
 */
export function getRecoveryLevel(score: number): RecoveryLevel {
  if (score >= RECOVERY_THRESHOLDS.L1) return RecoveryLevel.L1;
  if (score >= RECOVERY_THRESHOLDS.L2) return RecoveryLevel.L2;
  return RecoveryLevel.L3;
}

/**
 * Human-readable status label for manifest display.
 */
export function getFreezeStatus(
  level: RecoveryLevel
): "FROZEN" | "STABLE" | "OPEN" {
  switch (level) {
    case RecoveryLevel.L1:
      return "FROZEN";
    case RecoveryLevel.L2:
      return "STABLE";
    case RecoveryLevel.L3:
      return "OPEN";
  }
}
