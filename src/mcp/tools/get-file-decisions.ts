import Database from "better-sqlite3";
import { EventStore } from "../../db/event-store.js";
import { FreezeStore } from "../../db/freeze-store.js";
import { OverrideStore } from "../../db/override-store.js";
import { getFreezeStatus } from "../../core/recovery-levels.js";
import { DecisionEvent, FreezeScore, RecoveryLevel } from "../../core/types.js";
import { getTheoryHolders, FunctionTheory } from "../../graph/theory-holders.js";

export interface FileDecisionsResult {
  filePath: string;
  manifest: string;
  functions: FunctionSummary[];
}

interface FunctionSummary {
  functionName: string;
  functionId: string;
  freezeScore: number;
  recoveryLevel: RecoveryLevel;
  status: string;
  decisions: { intent: string; confidence: string; commitSha: string }[];
  overrideReason?: string;
  overrideExpires?: string;
  theoryHolders?: string; // "dev-a (active), dev-b (inactive 8mo)"
  theoryRisk?: string;    // "healthy" | "fragile" | "critical"
}

export function getFileDecisions(
  db: Database.Database,
  filePath: string,
  repoPath?: string
): FileDecisionsResult {
  const eventStore = new EventStore(db);
  const freezeStore = new FreezeStore(db);
  const overrideStore = new OverrideStore(db);

  // Expire overrides that have passed their deadline
  overrideStore.expireOverrides();

  const events = eventStore.getEventsForFile(filePath, repoPath);
  const scores = freezeStore.getScoresForFile(filePath, repoPath);

  const eventsByFunction = new Map<string, DecisionEvent[]>();
  for (const event of events) {
    if (!event.functionId) continue;
    const existing = eventsByFunction.get(event.functionId) ?? [];
    existing.push(event);
    eventsByFunction.set(event.functionId, existing);
  }

  const scoreMap = new Map<string, FreezeScore>(
    scores.map((s) => [s.functionId, s])
  );

  const functions: FunctionSummary[] = [];

  for (const [functionId, fnEvents] of eventsByFunction) {
    const score = scoreMap.get(functionId);
    const level = score?.recoveryLevel ?? RecoveryLevel.L3;
    const status = getFreezeStatus(level);

    const seenCommits = new Set<string>();
    const decisions: FunctionSummary["decisions"] = [];
    for (const event of fnEvents.reverse()) {
      if (!event.intent || seenCommits.has(event.commitSha)) continue;
      seenCommits.add(event.commitSha);
      decisions.push({
        intent: event.intent,
        confidence: event.confidence ?? "UNKNOWN",
        commitSha: event.commitSha.slice(0, 7),
      });
      if (decisions.length >= 5) break;
    }

    // Check for active override
    const override = overrideStore.getActiveOverride(functionId);

    // Get theory holders
    let theoryHolders: string | undefined;
    let theoryRisk: string | undefined;
    try {
      const theory = getTheoryHolders(db, repoPath ?? "", functionId);
      if (theory.holders.length > 0) {
        theoryHolders = theory.holders
          .slice(0, 3)
          .map((h) => {
            const status = h.isActive ? "active" : "inactive";
            return `${h.author} (${status})`;
          })
          .join(", ");
        theoryRisk = theory.riskLevel;
      }
    } catch {
      // Theory holder lookup is non-critical
    }

    functions.push({
      functionName:
        score?.functionName ??
        functionId.split("::function:")[1] ??
        functionId,
      functionId,
      freezeScore: score?.score ?? 0,
      recoveryLevel: level,
      status: override ? "OVERRIDE" : status,
      decisions,
      overrideReason: override?.reason,
      overrideExpires: override?.expiresAt?.toISOString().slice(0, 10),
      theoryHolders,
      theoryRisk,
    });
  }

  functions.sort((a, b) => b.freezeScore - a.freezeScore);

  const manifest = formatManifest(filePath, functions);
  return { filePath, manifest, functions };
}

function formatManifest(
  filePath: string,
  functions: FunctionSummary[]
): string {
  if (functions.length === 0) {
    return `[DECISION MANIFEST: ${filePath}]\nNo tracked functions found.`;
  }

  const lines: string[] = [
    `[DECISION MANIFEST: ${filePath}]`,
    "\u2501".repeat(50),
  ];

  for (const fn of functions) {
    const scoreStr = fn.freezeScore.toFixed(2);
    lines.push(
      `${fn.status}:  ${fn.functionName}()  [score: ${scoreStr}] [Recovery: ${fn.recoveryLevel}]`
    );

    if (fn.theoryHolders) {
      lines.push(`  Theory holders: ${fn.theoryHolders}`);
      if (fn.theoryRisk === "critical") {
        lines.push(`  \u26a0 FULL NAUR DEATH: No active contributors hold this function's theory.`);
      } else if (fn.theoryRisk === "fragile") {
        lines.push(`  \u26a0 Single point of theory failure — only 1 active contributor.`);
      }
    }

    if (fn.overrideReason) {
      lines.push(`  \u26a0 ACTIVE OVERRIDE: ${fn.overrideReason}`);
      if (fn.overrideExpires) {
        lines.push(`    Expires: ${fn.overrideExpires}`);
      }
      lines.push(`    This function is under active modification. Exercise extra caution.`);
    }

    for (const decision of fn.decisions) {
      lines.push(`  - ${decision.intent}`);
      lines.push(`    ${decision.confidence} \u2014 commit ${decision.commitSha}`);
    }

    lines.push("");
  }

  lines.push("\u2501".repeat(50));
  return lines.join("\n");
}
