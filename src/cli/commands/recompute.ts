import { resolve } from "node:path";
import { getDb, closeDb } from "../../db/database.js";
import { runRecomputePipeline } from "../../pipeline/recompute-pipeline.js";
import { logger } from "../../shared/logger.js";

export async function recomputeCommand(options: {
  path?: string;
}): Promise<void> {
  const repoPath = resolve(options.path ?? process.cwd());
  const db = getDb();

  try {
    const result = await runRecomputePipeline(
      repoPath,
      db,
      (current, total) => {
        if (current % 100 === 0 || current === total) {
          process.stderr.write(
            `\r  Recomputing ${current}/${total}...`
          );
        }
      }
    );

    process.stderr.write("\n");
    console.log(`\nRecompute complete:`);
    console.log(`  Functions recomputed: ${result.functionsRecomputed}`);
    console.log(`  Theory gaps found:    ${result.theoryGapsFound}`);
    console.log(`  Call graph:           ${result.graphNodes} nodes, ${result.graphEdges} edges`);
    console.log(`  Duration:             ${(result.durationMs / 1000).toFixed(1)}s`);
  } catch (err) {
    logger.error("Recompute failed", err);
    console.error(
      `Error: ${err instanceof Error ? err.message : String(err)}`
    );
    process.exit(1);
  } finally {
    closeDb();
  }
}
