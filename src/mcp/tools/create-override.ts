import Database from "better-sqlite3";
import { execSync } from "node:child_process";
import { OverrideStore } from "../../db/override-store.js";
import { EventStore } from "../../db/event-store.js";
import { FreezeStore } from "../../db/freeze-store.js";
import { calculateFreezeScore } from "../../core/freeze-calculator.js";
import {
  makeFunctionId,
  parseFunctionId,
  DecisionEvent,
  EventType,
  IntentSource,
  IntentConfidence,
} from "../../core/types.js";

function parseDuration(duration: string): number | null {
  const match = duration.match(/^(\d+)(d|h|m)$/);
  if (!match) return null;
  const value = parseInt(match[1], 10);
  switch (match[2]) {
    case "d": return value * 24 * 60 * 60 * 1000;
    case "h": return value * 60 * 60 * 1000;
    case "m": return value * 60 * 1000;
    default: return null;
  }
}

function getAuthor(): string {
  try {
    return execSync("git config user.name", { encoding: "utf-8" }).trim();
  } catch {
    return process.env.USER ?? "ai-agent";
  }
}

/**
 * Create an override via MCP tool call.
 * Called when Claude Code needs to modify a FROZEN/STABLE function.
 *
 * The user approves this tool call in Claude Code's UI — that
 * serves as the human approval for the override.
 */
export function createOverrideFromMcp(
  db: Database.Database,
  filePath: string,
  functionName: string,
  reason: string,
  expires?: string
): string {
  const overrideStore = new OverrideStore(db);
  const eventStore = new EventStore(db);
  const freezeStore = new FreezeStore(db);

  const functionId = makeFunctionId(filePath, functionName);
  const author = getAuthor();

  // Check current state
  const events = eventStore.getEventsForFunction(functionId);
  const currentScore = events.length > 0 ? calculateFreezeScore(events) : null;

  // Check for existing active override
  const existing = overrideStore.getActiveOverride(functionId);
  if (existing) {
    return [
      `Override already active for ${functionName}():`,
      `  Reason: ${existing.reason}`,
      `  By: ${existing.author}`,
      existing.expiresAt ? `  Expires: ${existing.expiresAt.toISOString().slice(0, 10)}` : `  Permanent`,
      "",
      "You may proceed with modifications.",
    ].join("\n");
  }

  // Parse expiry
  let expiresAt: Date | undefined;
  if (expires) {
    const ms = parseDuration(expires);
    if (ms) expiresAt = new Date(Date.now() + ms);
  }

  // Create the override
  const override = overrideStore.createOverride(
    "", // repoPath — empty for MCP context (repo-agnostic)
    functionId,
    reason,
    author,
    expiresAt
  );

  // Emit FREEZE_OVERRIDE event
  const parsed = parseFunctionId(functionId);
  const overrideEvent: DecisionEvent = {
    repoPath: "",
    commitSha: "override",
    eventType: EventType.FREEZE_OVERRIDE,
    functionId,
    filePath: parsed?.filePath ?? filePath,
    functionName: parsed?.functionName ?? functionName,
    commitMessage: null,
    author,
    authoredAt: new Date(),
    classification: null,
    intent: `OVERRIDE: ${reason}`,
    intentSource: IntentSource.OVERRIDE,
    confidence: IntentConfidence.HIGH,
    metadata: {
      overrideId: override.id,
      expiresAt: expiresAt?.toISOString() ?? null,
      source: "mcp",
    },
  };
  eventStore.appendEvents([overrideEvent]);

  // Build response
  const lines: string[] = [
    `Override applied for ${functionName}():`,
  ];

  if (currentScore) {
    lines.push(
      `  Previous: score ${currentScore.score.toFixed(2)} [${currentScore.recoveryLevel}]`
    );
  }

  lines.push(`  Reason: ${reason}`);
  lines.push(`  Author: ${author}`);

  if (expiresAt) {
    lines.push(`  Expires: ${expiresAt.toISOString().slice(0, 10)}`);
  } else {
    lines.push(`  Expires: permanent`);
  }

  lines.push("");
  lines.push("You may now modify this function. The override is recorded in the audit trail.");

  return lines.join("\n");
}
