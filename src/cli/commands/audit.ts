import { resolve } from "node:path";
import { getDb, closeDb } from "../../db/database.js";
import { getFileDecisions } from "../../mcp/tools/get-file-decisions.js";
import { logger } from "../../shared/logger.js";

export async function auditCommand(
  filePath: string,
  options: { path?: string }
): Promise<void> {
  const repoPath = options.path ? resolve(options.path) : undefined;
  const db = getDb();

  try {
    const result = getFileDecisions(db, filePath, repoPath);
    console.log(result.manifest);
  } catch (err) {
    logger.error("Audit failed", err);
    console.error(
      `Error: ${err instanceof Error ? err.message : String(err)}`
    );
    process.exit(1);
  } finally {
    closeDb();
  }
}
