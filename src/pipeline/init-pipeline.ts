import pg from "pg";
import { LogWalker } from "../git/log-walker.js";
import { parseDiff } from "../git/diff-parser.js";
import { initParser, parseSource } from "../ast/parser.js";
import { extractChunks } from "../ast/chunk-extractor.js";
import { mapDiffToFunctions } from "../ast/diff-mapper.js";
import { getLanguageForFile, isSupportedFile } from "../ast/languages/index.js";
import { classifyCommit } from "../core/commit-classifier.js";
import { extractIntent } from "../core/intent-extractor.js";
import { calculateFreezeScore } from "../core/freeze-calculator.js";
import {
  DecisionEvent,
  EventType,
  CommitInfo,
} from "../core/types.js";
import { EventStore } from "../db/event-store.js";
import { ChunkStore } from "../db/chunk-store.js";
import { FreezeStore } from "../db/freeze-store.js";
import { runMigrations } from "../db/migrator.js";
import { logger } from "../shared/logger.js";

export interface InitPipelineOptions {
  repoPath: string;
  pool: pg.Pool;
  fullHistory?: boolean;
  onProgress?: (current: number, total: number, sha: string) => void;
}

export interface InitPipelineResult {
  commitsProcessed: number;
  eventsCreated: number;
  functionsTracked: number;
  durationMs: number;
}

/**
 * Full history processing pipeline.
 *
 * Walks git log oldest→newest, for each commit:
 * 1. Classify commit message
 * 2. Parse changed files with Tree-sitter
 * 3. Extract function chunks
 * 4. Map diff hunks to functions
 * 5. Extract intent (rule-based)
 * 6. Append events to event store
 * 7. Compute freeze scores
 */
export async function runInitPipeline(
  options: InitPipelineOptions
): Promise<InitPipelineResult> {
  const { repoPath, pool } = options;
  const startTime = Date.now();

  // Step 1: Validate repo + run migrations
  const walker = new LogWalker(repoPath);
  await walker.validate();

  logger.info("Running database migrations...");
  await runMigrations(pool);

  const eventStore = new EventStore(pool);
  const chunkStore = new ChunkStore(pool);
  const freezeStore = new FreezeStore(pool);

  // Check if already indexed
  const hasExisting = await eventStore.hasEventsForRepo(repoPath);
  if (hasExisting && !options.fullHistory) {
    logger.info("Repository already indexed. Use --full-history to re-index.");
    return {
      commitsProcessed: 0,
      eventsCreated: 0,
      functionsTracked: 0,
      durationMs: Date.now() - startTime,
    };
  }

  // Step 2: Initialize Tree-sitter
  logger.info("Initializing AST parser...");
  await initParser();

  // Step 3: Walk git log
  const commits = await walker.getAllCommits();
  const totalCommits = commits.length;
  logger.info(`Processing ${totalCommits} commits...`);

  let eventsCreated = 0;
  const allFunctionIds = new Set<string>();

  for (let i = 0; i < commits.length; i++) {
    const commit = commits[i];
    options.onProgress?.(i + 1, totalCommits, commit.sha);

    const events = await processCommit(walker, commit, repoPath);

    if (events.length > 0) {
      await eventStore.appendEvents(events);
      eventsCreated += events.length;

      // Track function IDs for freeze score computation
      for (const event of events) {
        if (event.functionId) {
          allFunctionIds.add(event.functionId);
        }
      }
    }

    // Log progress every 100 commits
    if ((i + 1) % 100 === 0) {
      logger.info(`Processed ${i + 1}/${totalCommits} commits (${eventsCreated} events)`);
    }
  }

  // Step 4: Compute freeze scores for all tracked functions
  logger.info(`Computing freeze scores for ${allFunctionIds.size} functions...`);

  for (const functionId of allFunctionIds) {
    const events = await eventStore.getEventsForFunction(functionId, repoPath);
    const score = calculateFreezeScore(events);
    await freezeStore.upsertScore(repoPath, score);
  }

  const durationMs = Date.now() - startTime;
  logger.info(
    `Init complete: ${totalCommits} commits, ${eventsCreated} events, ${allFunctionIds.size} functions in ${(durationMs / 1000).toFixed(1)}s`
  );

  return {
    commitsProcessed: totalCommits,
    eventsCreated,
    functionsTracked: allFunctionIds.size,
    durationMs,
  };
}

/**
 * Process a single commit: parse diffs, extract chunks, create events.
 */
async function processCommit(
  walker: LogWalker,
  commit: CommitInfo,
  repoPath: string
): Promise<DecisionEvent[]> {
  const events: DecisionEvent[] = [];

  // Get the diff for this commit
  const diffText = await walker.getCommitDiff(commit.sha);
  if (!diffText.trim()) return events;

  // Parse the diff
  const fileDiffs = parseDiff(diffText);

  // Classify the commit message
  const classification = classifyCommit(commit.message);
  const intentResult = extractIntent(commit.message, classification);

  for (const fileDiff of fileDiffs) {
    const filePath = fileDiff.newPath;

    // Only process supported languages
    if (!isSupportedFile(filePath)) continue;
    const langConfig = getLanguageForFile(filePath);
    if (!langConfig) continue;

    // Get file content at this commit to parse AST
    let chunks;
    if (fileDiff.isDeleted) {
      // For deleted files, we can't get content at this commit
      // Create a deletion event for the file
      events.push({
        repoPath,
        commitSha: commit.sha,
        eventType: EventType.FUNCTION_DELETED,
        functionId: null,
        filePath,
        functionName: null,
        commitMessage: commit.message,
        author: commit.author,
        authoredAt: commit.date,
        classification,
        intent: intentResult?.intent ?? null,
        intentSource: intentResult?.source ?? null,
        confidence: intentResult?.confidence ?? null,
        metadata: {},
      });
      continue;
    }

    const fileContent = await walker.getFileAtCommit(commit.sha, filePath);
    if (!fileContent) continue;

    try {
      const tree = await parseSource(fileContent, langConfig);
      chunks = extractChunks(tree, filePath, langConfig);
    } catch {
      // AST parse failure — skip this file
      continue;
    }

    if (chunks.length === 0) continue;

    // Map diff hunks to affected functions
    const affected = mapDiffToFunctions(
      fileDiff.hunks,
      chunks,
      fileDiff.isNew,
      fileDiff.isDeleted
    );

    for (const { chunk, changeType } of affected) {
      const eventType =
        changeType === "created"
          ? EventType.FUNCTION_CREATED
          : changeType === "deleted"
            ? EventType.FUNCTION_DELETED
            : EventType.FUNCTION_CHANGED;

      events.push({
        repoPath,
        commitSha: commit.sha,
        eventType,
        functionId: chunk.functionId,
        filePath: chunk.filePath,
        functionName: chunk.functionName,
        commitMessage: commit.message,
        author: commit.author,
        authoredAt: commit.date,
        classification,
        intent: intentResult?.intent ?? null,
        intentSource: intentResult?.source ?? null,
        confidence: intentResult?.confidence ?? null,
        metadata: {},
      });
    }
  }

  return events;
}
