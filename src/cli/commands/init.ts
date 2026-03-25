import { resolve } from "node:path";
import { getPool, closePool } from "../../db/pool.js";
import { runInitPipeline } from "../../pipeline/init-pipeline.js";
import { logger } from "../../shared/logger.js";

export async function initCommand(options: {
  fullHistory?: boolean;
  path?: string;
}): Promise<void> {
  const repoPath = resolve(options.path ?? process.cwd());
  const pool = getPool();

  try {
    const result = await runInitPipeline({
      repoPath,
      pool,
      fullHistory: options.fullHistory,
      onProgress: (current, total, sha) => {
        if (current % 50 === 0 || current === total) {
          process.stderr.write(
            `\r  Processing commit ${current}/${total} (${sha.slice(0, 7)})...`
          );
        }
      },
    });

    process.stderr.write("\n");
    console.log(`\ngitwise init complete:`);
    console.log(`  Commits processed: ${result.commitsProcessed}`);
    console.log(`  Events created:    ${result.eventsCreated}`);
    console.log(`  Functions tracked: ${result.functionsTracked}`);
    console.log(`  Duration:          ${(result.durationMs / 1000).toFixed(1)}s`);
  } catch (err) {
    logger.error("Init failed", err);
    console.error(
      `Error: ${err instanceof Error ? err.message : String(err)}`
    );
    process.exit(1);
  } finally {
    await closePool();
  }
}
