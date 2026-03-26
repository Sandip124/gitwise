import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { getDb, closeDb } from "../../db/database.js";
import { getRepoTheoryHealth } from "../../graph/theory-holders.js";
import { readJsonl } from "../../shared/jsonl.js";
import {
  getWisegitPaths,
  SharedEnrichment,
  SharedOverride,
} from "../../shared/team-types.js";
import { logger } from "../../shared/logger.js";

export async function teamStatusCommand(options: {
  path?: string;
}): Promise<void> {
  const repoPath = resolve(options.path ?? process.cwd());
  const db = getDb();
  const paths = getWisegitPaths(repoPath);

  try {
    console.log("Team Status\n");

    // Enrichment coverage
    const totalIssueRefs = (
      db
        .prepare(
          `SELECT COUNT(DISTINCT commit_message) as cnt FROM decision_events
           WHERE repo_path = ? AND commit_message LIKE '%#%'`
        )
        .get(repoPath) as { cnt: number }
    ).cnt;

    let enriched = 0;
    let enrichedBy = new Set<string>();
    if (existsSync(paths.enrichments)) {
      const entries = readJsonl<SharedEnrichment>(paths.enrichments);
      enriched = entries.length;
      enrichedBy = new Set(entries.map((e) => e.fetched_by));
    }

    console.log("  Enrichment Coverage:");
    console.log(`    Commits with issue refs: ${totalIssueRefs}`);
    console.log(`    Issues enriched:         ${enriched}`);
    if (enrichedBy.size > 0) {
      console.log(`    Enriched by:             ${[...enrichedBy].join(", ")}`);
    }

    // Active overrides
    let activeOverrides = 0;
    let overrideAuthors = new Set<string>();
    if (existsSync(paths.overrides)) {
      const entries = readJsonl<SharedOverride>(paths.overrides);
      for (const o of entries) {
        if (o.revoked) continue;
        if (o.expires_at && new Date(o.expires_at) < new Date()) continue;
        activeOverrides++;
        overrideAuthors.add(o.created_by);
      }
    }

    console.log("\n  Active Overrides:");
    console.log(`    Count:   ${activeOverrides}`);
    if (overrideAuthors.size > 0) {
      console.log(`    Authors: ${[...overrideAuthors].join(", ")}`);
    }

    // Contributor activity
    const activeContributors = (
      db
        .prepare(
          `SELECT COUNT(DISTINCT author) as cnt FROM decision_events
           WHERE repo_path = ? AND authored_at > datetime('now', '-6 months')`
        )
        .get(repoPath) as { cnt: number }
    ).cnt;

    const totalContributors = (
      db
        .prepare(
          `SELECT COUNT(DISTINCT author) as cnt FROM decision_events
           WHERE repo_path = ?`
        )
        .get(repoPath) as { cnt: number }
    ).cnt;

    console.log("\n  Contributors:");
    console.log(`    Active (6mo):  ${activeContributors}`);
    console.log(`    Total:         ${totalContributors}`);

    // Function count
    const totalFunctions = (
      db
        .prepare(
          `SELECT COUNT(DISTINCT function_id) as cnt FROM decision_events
           WHERE repo_path = ? AND function_id IS NOT NULL`
        )
        .get(repoPath) as { cnt: number }
    ).cnt;

    console.log(`\n  Functions tracked: ${totalFunctions}`);
  } catch (err) {
    logger.error("Team status failed", err);
    console.error(
      `Error: ${err instanceof Error ? err.message : String(err)}`
    );
    process.exit(1);
  } finally {
    closeDb();
  }
}

export async function teamTheoryHealthCommand(options: {
  path?: string;
}): Promise<void> {
  const repoPath = resolve(options.path ?? process.cwd());
  const db = getDb();

  try {
    const health = getRepoTheoryHealth(db, repoPath);

    console.log("Theory Health Summary\n");
    console.log(`  Total functions: ${health.total}`);
    console.log(`  Healthy (2+ active holders): ${health.healthy} (${pct(health.healthy, health.total)})`);
    console.log(`  Fragile (1 active holder):   ${health.fragile} (${pct(health.fragile, health.total)})`);
    console.log(`  Critical (0 active holders): ${health.critical} (${pct(health.critical, health.total)})`);

    if (health.topRisks.length > 0) {
      console.log(`\n  Top Risk Functions (full Naur death):\n`);
      for (const fn of health.topRisks) {
        const lastHolder = fn.holders[0];
        const inactiveInfo = lastHolder
          ? `last active: ${lastHolder.lastActive.slice(0, 10)}`
          : "no history";
        console.log(`    ${fn.filePath}::${fn.functionName}()`);
        console.log(`      ${fn.totalCount} past contributor(s), all inactive (${inactiveInfo})`);
      }
    }
  } catch (err) {
    logger.error("Theory health failed", err);
    console.error(
      `Error: ${err instanceof Error ? err.message : String(err)}`
    );
    process.exit(1);
  } finally {
    closeDb();
  }
}

function pct(n: number, total: number): string {
  if (total === 0) return "0%";
  return `${((n / total) * 100).toFixed(1)}%`;
}
