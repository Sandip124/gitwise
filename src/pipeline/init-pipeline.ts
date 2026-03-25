import Database from "better-sqlite3";
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
  db: Database.Database;
  fullHistory?: boolean;
  onProgress?: (current: number, total: number, sha: string) => void;
}

export interface InitPipelineResult {
  commitsProcessed: number;
  eventsCreated: number;
  functionsTracked: number;
  durationMs: number;
}

export async function runInitPipeline(
  options: InitPipelineOptions
): Promise<InitPipelineResult> {
  const { repoPath, db } = options;
  const startTime = Date.now();

  const walker = new LogWalker(repoPath);
  await walker.validate();

  logger.info("Running database migrations...");
  runMigrations(db);

  const eventStore = new EventStore(db);
  const chunkStore = new ChunkStore(db);
  const freezeStore = new FreezeStore(db);

  const hasExisting = eventStore.hasEventsForRepo(repoPath);
  if (hasExisting && !options.fullHistory) {
    logger.info("Repository already indexed. Use --full-history to re-index.");
    return {
      commitsProcessed: 0,
      eventsCreated: 0,
      functionsTracked: 0,
      durationMs: Date.now() - startTime,
    };
  }

  logger.info("Initializing AST parser...");
  await initParser();

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
      eventStore.appendEvents(events);
      eventsCreated += events.length;

      for (const event of events) {
        if (event.functionId) {
          allFunctionIds.add(event.functionId);
        }
      }
    }

    if ((i + 1) % 100 === 0) {
      logger.info(
        `Processed ${i + 1}/${totalCommits} commits (${eventsCreated} events)`
      );
    }
  }

  // Store current function chunks (needed for call graph / PageRank)
  logger.info("Storing function chunks from HEAD...");
  await storeCurrentChunks(walker, repoPath, chunkStore);

  logger.info(
    `Computing freeze scores for ${allFunctionIds.size} functions...`
  );

  for (const functionId of allFunctionIds) {
    const events = eventStore.getEventsForFunction(functionId, repoPath);
    const score = calculateFreezeScore(events);
    freezeStore.upsertScore(repoPath, score);
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

async function processCommit(
  walker: LogWalker,
  commit: CommitInfo,
  repoPath: string
): Promise<DecisionEvent[]> {
  const events: DecisionEvent[] = [];

  const diffText = await walker.getCommitDiff(commit.sha);
  if (!diffText.trim()) return events;

  const fileDiffs = parseDiff(diffText);
  const classification = classifyCommit(commit.message);
  const intentResult = extractIntent(commit.message, classification);

  for (const fileDiff of fileDiffs) {
    const filePath = fileDiff.newPath;

    if (!isSupportedFile(filePath)) continue;
    const langConfig = getLanguageForFile(filePath);
    if (!langConfig) continue;

    if (fileDiff.isDeleted) {
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

    let chunks;
    try {
      const tree = await parseSource(fileContent, langConfig);
      chunks = extractChunks(tree, filePath, langConfig);
    } catch {
      continue;
    }

    if (chunks.length === 0) continue;

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

/**
 * Parse all supported files at HEAD and store function chunks.
 * Needed for call graph construction (PageRank).
 */
async function storeCurrentChunks(
  walker: LogWalker,
  repoPath: string,
  chunkStore: ChunkStore
): Promise<void> {
  const latestCommit = await walker.getLatestCommit();
  if (!latestCommit) return;

  const { readdirSync, statSync } = await import("node:fs");
  const { resolve, relative } = await import("node:path");

  function walkDir(dir: string): string[] {
    const files: string[] = [];
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith(".")) continue;
        if (entry.name === "node_modules") continue;
        if (entry.name === "dist") continue;
        if (entry.name === "bin") continue;
        if (entry.name === "obj") continue;

        const full = resolve(dir, entry.name);
        if (entry.isDirectory()) {
          files.push(...walkDir(full));
        } else if (isSupportedFile(entry.name)) {
          files.push(full);
        }
      }
    } catch {
      // Permission denied or similar
    }
    return files;
  }

  const allFiles = walkDir(repoPath);
  let stored = 0;

  for (const fullPath of allFiles) {
    const relPath = relative(repoPath, fullPath);
    const langConfig = getLanguageForFile(relPath);
    if (!langConfig) continue;

    let content: string;
    try {
      const { readFileSync } = await import("node:fs");
      content = readFileSync(fullPath, "utf-8");
    } catch {
      continue;
    }

    try {
      const tree = await parseSource(content, langConfig);
      const chunks = extractChunks(tree, relPath, langConfig);
      if (chunks.length > 0) {
        chunkStore.upsertChunks(repoPath, chunks, latestCommit.sha);
        stored += chunks.length;
      }
    } catch {
      continue;
    }
  }

  logger.info(`Stored ${stored} function chunks from ${allFiles.length} files`);
}
