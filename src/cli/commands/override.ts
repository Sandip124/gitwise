import { resolve } from "node:path";
import { execSync } from "node:child_process";
import { getDb, closeDb } from "../../db/database.js";
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
import { appendJsonl } from "../../shared/jsonl.js";
import { getWisegitPaths, SharedOverride } from "../../shared/team-types.js";
import { logger } from "../../shared/logger.js";

/**
 * Parse a duration string like "7d", "24h", "30m" into milliseconds.
 */
function parseDuration(duration: string): number | null {
  const match = duration.match(/^(\d+)(d|h|m)$/);
  if (!match) return null;

  const value = parseInt(match[1], 10);
  switch (match[2]) {
    case "d":
      return value * 24 * 60 * 60 * 1000;
    case "h":
      return value * 60 * 60 * 1000;
    case "m":
      return value * 60 * 1000;
    default:
      return null;
  }
}

/**
 * Get the current git user name for the override author.
 */
function getGitAuthor(): string {
  try {
    return execSync("git config user.name", { encoding: "utf-8" }).trim();
  } catch {
    return process.env.USER ?? "unknown";
  }
}

export async function overrideCommand(
  target: string,
  options: {
    reason?: string;
    file?: string;
    path?: string;
    expires?: string;
    list?: boolean;
    revoke?: string;
  }
): Promise<void> {
  const repoPath = resolve(options.path ?? process.cwd());
  const db = getDb();
  const overrideStore = new OverrideStore(db);
  const eventStore = new EventStore(db);
  const freezeStore = new FreezeStore(db);

  try {
    // Expire any overrides that have passed their deadline
    const expired = overrideStore.expireOverrides();
    if (expired > 0) {
      console.log(`  (${expired} expired override(s) deactivated)\n`);
    }

    // List mode: show all active overrides
    if (options.list) {
      const overrides = overrideStore.getOverridesForRepo(repoPath);
      if (overrides.length === 0) {
        console.log("No active overrides.");
        return;
      }

      console.log(`Active overrides (${overrides.length}):\n`);
      for (const o of overrides) {
        const parsed = parseFunctionId(o.functionId);
        const name = parsed
          ? `${parsed.filePath}::${parsed.functionName}`
          : o.functionId;
        const expiry = o.expiresAt
          ? ` [expires ${o.expiresAt.toISOString().slice(0, 10)}]`
          : " [permanent]";

        console.log(`  ${name}${expiry}`);
        console.log(`    Reason: ${o.reason}`);
        console.log(`    By: ${o.author} on ${o.createdAt.toISOString().slice(0, 10)}`);
        console.log();
      }
      return;
    }

    // Revoke mode: deactivate a specific override
    if (options.revoke) {
      const functionId = options.file
        ? makeFunctionId(options.file, options.revoke)
        : null;

      if (!functionId) {
        console.error("Error: --file is required with --revoke to identify the function.");
        process.exit(1);
      }

      const existing = overrideStore.getActiveOverride(functionId);
      if (!existing) {
        console.log(`No active override found for ${options.revoke}.`);
        return;
      }

      overrideStore.deactivateOverride(existing.id);
      console.log(`Override revoked for ${options.revoke}.`);
      console.log(`  Original reason: ${existing.reason}`);

      // Recompute freeze score
      const events = eventStore.getEventsForFunction(functionId, repoPath);
      const score = calculateFreezeScore(events);
      freezeStore.upsertScore(repoPath, score);
      console.log(`  Freeze score recomputed: ${score.score.toFixed(2)}`);
      return;
    }

    // Create mode: apply a new override
    if (!options.reason) {
      console.error("Error: --reason is mandatory. No override without a reason.");
      console.error("Usage: wisegit override <function> --file <path> --reason \"...\"");
      process.exit(1);
    }

    // Resolve function ID
    const functionId = options.file
      ? makeFunctionId(options.file, target)
      : target;

    // Show current state before override
    const events = eventStore.getEventsForFunction(functionId, repoPath);
    if (events.length > 0) {
      console.log("Current state:");
      const score = calculateFreezeScore(events);
      console.log(`  ${target}()  [score: ${score.score.toFixed(2)}] [${score.recoveryLevel}]`);

      // Show most recent intents
      const recentIntents = events
        .filter((e) => e.intent)
        .slice(-3)
        .reverse();
      for (const e of recentIntents) {
        console.log(`  - ${e.intent}`);
      }
      console.log();
    }

    // Parse expiry
    let expiresAt: Date | undefined;
    if (options.expires) {
      const durationMs = parseDuration(options.expires);
      if (!durationMs) {
        console.error(
          `Error: Invalid duration "${options.expires}". Use format: 7d, 24h, 30m`
        );
        process.exit(1);
      }
      expiresAt = new Date(Date.now() + durationMs);
    }

    const author = getGitAuthor();

    // Create the override
    const override = overrideStore.createOverride(
      repoPath,
      functionId,
      options.reason,
      author,
      expiresAt
    );

    // Emit FREEZE_OVERRIDE event into the append-only log
    const overrideEvent: DecisionEvent = {
      repoPath,
      commitSha: "override",
      eventType: EventType.FREEZE_OVERRIDE,
      functionId,
      filePath: parseFunctionId(functionId)?.filePath ?? "",
      functionName: parseFunctionId(functionId)?.functionName ?? target,
      commitMessage: null,
      author,
      authoredAt: new Date(),
      classification: null,
      intent: `OVERRIDE: ${options.reason}`,
      intentSource: IntentSource.OVERRIDE,
      confidence: IntentConfidence.HIGH,
      metadata: {
        overrideId: override.id,
        expiresAt: expiresAt?.toISOString() ?? null,
      },
    };
    eventStore.appendEvents([overrideEvent]);

    // Write to .wisegit/overrides.jsonl for team sharing
    const paths = getWisegitPaths(repoPath);
    const currentScore = events.length > 0 ? calculateFreezeScore(events) : null;
    const sharedOverride: SharedOverride = {
      id: override.id,
      function_id: functionId,
      created_by: author,
      created_at: new Date().toISOString(),
      reason: options.reason,
      expires_at: expiresAt?.toISOString() ?? null,
      scope: "function",
      previous_score: currentScore?.score ?? null,
      approved_by: null,
    };
    appendJsonl(paths.overrides, sharedOverride);

    // Recompute freeze score (override resets protection)
    const allEvents = eventStore.getEventsForFunction(functionId, repoPath);
    const newScore = calculateFreezeScore(allEvents);
    freezeStore.upsertScore(repoPath, newScore);

    console.log("Override applied:");
    console.log(`  Function: ${target}`);
    console.log(`  Reason:   ${options.reason}`);
    console.log(`  Author:   ${author}`);
    if (expiresAt) {
      console.log(`  Expires:  ${expiresAt.toISOString().slice(0, 10)}`);
    } else {
      console.log("  Expires:  permanent (use --expires to set deadline)");
    }
    console.log(`  New score: ${newScore.score.toFixed(2)} [${newScore.recoveryLevel}]`);
    console.log(
      "\n  Warning: LLM agents will be informed this function is under active override."
    );
  } catch (err) {
    logger.error("Override failed", err);
    console.error(
      `Error: ${err instanceof Error ? err.message : String(err)}`
    );
    process.exit(1);
  } finally {
    closeDb();
  }
}
