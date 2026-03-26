import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import Database from "better-sqlite3";
import { extractIntentViaSampling, isSamplingAvailable } from "../../llm/sampling.js";
import { extractIntentWithLlm, isOllamaAvailable } from "../../llm/client.js";
import { EventStore } from "../../db/event-store.js";
import {
  makeFunctionId,
  DecisionEvent,
  EventType,
  IntentSource,
  IntentConfidence,
} from "../../core/types.js";
import { logger } from "../../shared/logger.js";

/**
 * Extract intent for a NOISE commit's function — uses the best available LLM:
 * 1. MCP sampling (host LLM — Claude Code) — preferred, no extra setup
 * 2. Ollama (local LLM) — fallback for CLI mode
 *
 * Called when Claude Code encounters a function with LOW/no intent and wants
 * to understand what a past change was about.
 */
export async function extractIntentForFunction(
  server: Server | null,
  db: Database.Database,
  filePath: string,
  functionName: string,
  repoPath?: string
): Promise<string> {
  const eventStore = new EventStore(db);
  const functionId = makeFunctionId(filePath, functionName);
  const events = eventStore.getEventsForFunction(functionId, repoPath);

  // Find events with no intent (NOISE commits)
  const noIntent = events.filter((e) => !e.intent && e.commitMessage);
  if (noIntent.length === 0) {
    return `All events for ${functionName}() already have extracted intent.`;
  }

  const lines: string[] = [
    `Extracting intent for ${noIntent.length} NOISE event(s) in ${functionName}():`,
    "",
  ];

  let extracted = 0;

  for (const event of noIntent) {
    let intent: string | null = null;

    // Try MCP sampling first (host LLM)
    if (server && isSamplingAvailable(server)) {
      intent = await extractIntentViaSampling(
        server,
        event.commitMessage ?? "",
        event.commitMessage ?? ""
      );
      if (intent) {
        lines.push(`  ${event.commitSha.slice(0, 7)}: ${intent} [via host LLM]`);
      }
    }

    // Fallback to Ollama
    if (!intent && (await isOllamaAvailable())) {
      intent = await extractIntentWithLlm(
        event.commitMessage ?? "",
        ""
      );
      if (intent) {
        lines.push(`  ${event.commitSha.slice(0, 7)}: ${intent} [via Ollama]`);
      }
    }

    if (intent) {
      // Store the extracted intent as a new event
      const intentEvent: DecisionEvent = {
        repoPath: event.repoPath,
        commitSha: event.commitSha,
        eventType: EventType.INTENT_EXTRACTED,
        functionId,
        filePath,
        functionName,
        commitMessage: event.commitMessage,
        author: event.author,
        authoredAt: event.authoredAt,
        classification: event.classification,
        intent,
        intentSource: server && isSamplingAvailable(server)
          ? IntentSource.LLM
          : IntentSource.LLM,
        confidence: IntentConfidence.MEDIUM,
        metadata: { extractedBy: server ? "mcp-sampling" : "ollama" },
      };
      eventStore.appendEvents([intentEvent]);
      extracted++;
    } else {
      lines.push(
        `  ${event.commitSha.slice(0, 7)}: Could not extract (no LLM available)`
      );
    }
  }

  lines.push("");
  lines.push(`Extracted intent for ${extracted}/${noIntent.length} events.`);

  if (extracted === 0) {
    lines.push(
      "No LLM available. For CLI: install Ollama (ollama.com). In Claude Code: sampling is automatic."
    );
  }

  return lines.join("\n");
}
