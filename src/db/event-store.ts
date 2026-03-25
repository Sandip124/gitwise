import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { DecisionEvent, EventType } from "../core/types.js";

/**
 * Append-only event store for decision events.
 * Per Kim et al. [8]: dynamic event sourcing adapts to new fault distributions.
 */
export class EventStore {
  constructor(private db: Database.Database) {}

  appendEvents(events: DecisionEvent[]): void {
    if (events.length === 0) return;

    const insert = this.db.prepare(
      `INSERT INTO decision_events
        (id, repo_path, commit_sha, event_type, function_id, file_path,
         function_name, commit_message, author, authored_at,
         classification, intent, intent_source, confidence, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    const insertMany = this.db.transaction((evts: DecisionEvent[]) => {
      for (const event of evts) {
        insert.run(
          randomUUID(),
          event.repoPath,
          event.commitSha,
          event.eventType,
          event.functionId,
          event.filePath,
          event.functionName,
          event.commitMessage,
          event.author,
          event.authoredAt?.toISOString() ?? null,
          event.classification,
          event.intent,
          event.intentSource,
          event.confidence,
          JSON.stringify(event.metadata)
        );
      }
    });

    insertMany(events);
  }

  getEventsForFunction(
    functionId: string,
    repoPath?: string
  ): DecisionEvent[] {
    if (repoPath) {
      return this.db
        .prepare(
          `SELECT * FROM decision_events
           WHERE function_id = ? AND repo_path = ?
           ORDER BY authored_at ASC, created_at ASC`
        )
        .all(functionId, repoPath)
        .map(rowToEvent);
    }

    return this.db
      .prepare(
        `SELECT * FROM decision_events
         WHERE function_id = ?
         ORDER BY authored_at ASC, created_at ASC`
      )
      .all(functionId)
      .map(rowToEvent);
  }

  getEventsForFile(
    filePath: string,
    repoPath?: string
  ): DecisionEvent[] {
    if (repoPath) {
      return this.db
        .prepare(
          `SELECT * FROM decision_events
           WHERE file_path = ? AND repo_path = ?
           ORDER BY authored_at ASC, created_at ASC`
        )
        .all(filePath, repoPath)
        .map(rowToEvent);
    }

    return this.db
      .prepare(
        `SELECT * FROM decision_events
         WHERE file_path = ?
         ORDER BY authored_at ASC, created_at ASC`
      )
      .all(filePath)
      .map(rowToEvent);
  }

  getDistinctFunctionIds(repoPath: string): string[] {
    return (
      this.db
        .prepare(
          `SELECT DISTINCT function_id FROM decision_events
           WHERE repo_path = ? AND function_id IS NOT NULL`
        )
        .all(repoPath) as { function_id: string }[]
    ).map((r) => r.function_id);
  }

  hasEventsForRepo(repoPath: string): boolean {
    const row = this.db
      .prepare(
        `SELECT 1 FROM decision_events WHERE repo_path = ? LIMIT 1`
      )
      .get(repoPath);
    return row !== undefined;
  }
}

function rowToEvent(row: unknown): DecisionEvent {
  const r = row as Record<string, unknown>;
  return {
    id: r.id as string,
    repoPath: r.repo_path as string,
    commitSha: r.commit_sha as string,
    eventType: r.event_type as EventType,
    functionId: r.function_id as string | null,
    filePath: r.file_path as string,
    functionName: r.function_name as string | null,
    commitMessage: r.commit_message as string | null,
    author: r.author as string | null,
    authoredAt: r.authored_at ? new Date(r.authored_at as string) : null,
    classification: r.classification as DecisionEvent["classification"],
    intent: r.intent as string | null,
    intentSource: r.intent_source as DecisionEvent["intentSource"],
    confidence: r.confidence as DecisionEvent["confidence"],
    metadata: r.metadata ? JSON.parse(r.metadata as string) : {},
    createdAt: r.created_at ? new Date(r.created_at as string) : undefined,
  };
}
