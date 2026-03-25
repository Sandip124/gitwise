import { resolve } from "node:path";
import { getPool, closePool } from "../../db/pool.js";
import { getFileDecisions } from "../../mcp/tools/get-file-decisions.js";
import { logger } from "../../shared/logger.js";

export async function auditCommand(
  filePath: string,
  options: { path?: string }
): Promise<void> {
  const repoPath = options.path ? resolve(options.path) : undefined;
  const pool = getPool();

  try {
    const result = await getFileDecisions(pool, filePath, repoPath);
    console.log(result.manifest);
  } catch (err) {
    logger.error("Audit failed", err);
    console.error(
      `Error: ${err instanceof Error ? err.message : String(err)}`
    );
    process.exit(1);
  } finally {
    await closePool();
  }
}
