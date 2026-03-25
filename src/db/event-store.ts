import pg from "pg";
import { DecisionEvent, EventType } from "../core/types.js";

/**
 * Append-only event store for decision events.
 * Per Kim et al. [8]: dynamic event sourcing adapts to new fault distributions.
 */
export class EventStore {
  constructor(private pool: pg.Pool) {}

  async appendEvents(events: DecisionEvent[]): Promise<void> {
    if (events.length === 0) return;

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      for (const event of events) {
        await client.query(
          `INSERT INTO decision_events
            (repo_path, commit_sha, event_type, function_id, file_path,
             function_name, commit_message, author, authored_at,
             classification, intent, intent_source, confidence, metadata)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
          [
            event.repoPath,
            event.commitSha,
            event.eventType,
            event.functionId,
            event.filePath,
            event.functionName,
            event.commitMessage,
            event.author,
            event.authoredAt,
            event.classification,
            event.intent,
            event.intentSource,
            event.confidence,
            JSON.stringify(event.metadata),
          ]
        );
      }

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async getEventsForFunction(
    functionId: string,
    repoPath?: string
  ): Promise<DecisionEvent[]> {
    const params: unknown[] = [functionId];
    let where = "WHERE function_id = $1";
    if (repoPath) {
      where += " AND repo_path = $2";
      params.push(repoPath);
    }

    const { rows } = await this.pool.query(
      `SELECT * FROM decision_events ${where} ORDER BY authored_at ASC, created_at ASC`,
      params
    );
    return rows.map(rowToEvent);
  }

  async getEventsForFile(
    filePath: string,
    repoPath?: string
  ): Promise<DecisionEvent[]> {
    const params: unknown[] = [filePath];
    let where = "WHERE file_path = $1";
    if (repoPath) {
      where += " AND repo_path = $2";
      params.push(repoPath);
    }

    const { rows } = await this.pool.query(
      `SELECT * FROM decision_events ${where} ORDER BY authored_at ASC, created_at ASC`,
      params
    );
    return rows.map(rowToEvent);
  }

  async getEventsForCommit(commitSha: string): Promise<DecisionEvent[]> {
    const { rows } = await this.pool.query(
      `SELECT * FROM decision_events WHERE commit_sha = $1 ORDER BY created_at ASC`,
      [commitSha]
    );
    return rows.map(rowToEvent);
  }

  async getDistinctFunctionIds(repoPath: string): Promise<string[]> {
    const { rows } = await this.pool.query(
      `SELECT DISTINCT function_id FROM decision_events
       WHERE repo_path = $1 AND function_id IS NOT NULL`,
      [repoPath]
    );
    return rows.map((r: { function_id: string }) => r.function_id);
  }

  async hasEventsForRepo(repoPath: string): Promise<boolean> {
    const { rows } = await this.pool.query(
      `SELECT 1 FROM decision_events WHERE repo_path = $1 LIMIT 1`,
      [repoPath]
    );
    return rows.length > 0;
  }
}

function rowToEvent(row: Record<string, unknown>): DecisionEvent {
  return {
    id: row.id as string,
    repoPath: row.repo_path as string,
    commitSha: row.commit_sha as string,
    eventType: row.event_type as EventType,
    functionId: row.function_id as string | null,
    filePath: row.file_path as string,
    functionName: row.function_name as string | null,
    commitMessage: row.commit_message as string | null,
    author: row.author as string | null,
    authoredAt: row.authored_at ? new Date(row.authored_at as string) : null,
    classification: row.classification as DecisionEvent["classification"],
    intent: row.intent as string | null,
    intentSource: row.intent_source as DecisionEvent["intentSource"],
    confidence: row.confidence as DecisionEvent["confidence"],
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    createdAt: row.created_at ? new Date(row.created_at as string) : undefined,
  };
}
