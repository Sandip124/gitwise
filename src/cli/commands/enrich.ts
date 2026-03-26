import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { getDb, closeDb } from "../../db/database.js";
import { detectRemote } from "../../git/remote-detector.js";
import { IssueEnricher } from "../../issues/issue-enricher.js";
import { EventStore } from "../../db/event-store.js";
import { FreezeStore } from "../../db/freeze-store.js";
import { calculateFreezeScore } from "../../core/freeze-calculator.js";
import { logger } from "../../shared/logger.js";
import { appendJsonl } from "../../shared/jsonl.js";
import {
  getWisegitPaths,
  SharedEnrichment,
} from "../../shared/team-types.js";

function getAuthor(): string {
  try {
    return execFileSync("git", ["config", "user.email"], { encoding: "utf-8" }).trim();
  } catch {
    return process.env.USER ?? "unknown";
  }
}

export async function enrichCommand(options: {
  path?: string;
}): Promise<void> {
  const repoPath = resolve(options.path ?? process.cwd());
  const db = getDb();
  const paths = getWisegitPaths(repoPath);
  const author = getAuthor();

  try {
    const remote = await detectRemote(repoPath);
    if (!remote) {
      console.error(
        "Error: Could not detect git remote. Is this a GitHub/GitLab repo?"
      );
      process.exit(1);
    }

    console.log(
      `Platform: ${remote.platform} (${remote.owner}/${remote.repo})`
    );

    if (remote.platform !== "github" && remote.platform !== "gitlab") {
      console.error(
        `Error: ${remote.platform} is not yet supported for issue enrichment.`
      );
      console.log("Supported: github, gitlab");
      process.exit(1);
    }

    if (remote.platform === "github") {
      const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
      if (!token) {
        console.log(
          "  Warning: No GITHUB_TOKEN set. Rate limit: 60 req/hr."
        );
        console.log(
          "  Set GITHUB_TOKEN or GH_TOKEN for 5000 req/hr.\n"
        );
      }
    }

    const enricher = new IssueEnricher(db, remote);
    const result = await enricher.enrichRepo(
      repoPath,
      (current, total) => {
        if (current % 10 === 0 || current === total) {
          process.stderr.write(
            `\r  Fetching issue ${current}/${total}...`
          );
        }
      }
    );

    process.stderr.write("\n");

    // Write enrichments to .wisegit/enrichments.jsonl for team sharing
    if (result.issuesFetched > 0) {
      const enrichments = db
        .prepare(
          `SELECT * FROM issue_enrichments WHERE repo_path = ?
           ORDER BY fetched_at DESC LIMIT ?`
        )
        .all(repoPath, result.issuesFetched) as Record<string, unknown>[];

      for (const row of enrichments) {
        const entry: SharedEnrichment = {
          issue_ref: row.issue_ref as string,
          platform: row.platform as string,
          repo: `${remote.owner}/${remote.repo}`,
          fetched_at: new Date().toISOString(),
          fetched_by: author,
          title: (row.issue_title as string) ?? "",
          resolution: (row.issue_status as string) ?? null,
          labels: JSON.parse((row.labels as string) ?? "[]"),
          has_repro_steps: false,
          body_excerpt: (row.issue_body as string)?.slice(0, 200) ?? null,
          linked_pr: null,
          signal_boosts: { freeze_boost: (row.freeze_boost as number) ?? 0 },
        };
        appendJsonl(paths.enrichments, entry);
      }
      console.log(`  Wrote ${enrichments.length} enrichments to .wisegit/enrichments.jsonl`);
    }

    console.log(`\nEnrichment complete:`);
    console.log(`  Issue refs found:     ${result.issuesFound}`);
    console.log(`  Issues fetched:       ${result.issuesFetched}`);
    console.log(`  Issues unreachable:   ${result.issuesUnreachable}`);
    console.log(`  Won't Fix / By Design: ${result.wontFixCount}`);
    console.log(`  Events created:       ${result.eventsCreated}`);

    if (result.eventsCreated > 0) {
      console.log("\n  Recomputing freeze scores...");
      const eventStore = new EventStore(db);
      const freezeStore = new FreezeStore(db);
      const functionIds = eventStore.getDistinctFunctionIds(repoPath);

      for (const functionId of functionIds) {
        const events = eventStore.getEventsForFunction(functionId, repoPath);
        const score = calculateFreezeScore(events);
        freezeStore.upsertScore(repoPath, score);
      }
      console.log(`  Recomputed ${functionIds.length} freeze scores`);
    }
  } catch (err) {
    logger.error("Enrich failed", err);
    console.error(
      `Error: ${err instanceof Error ? err.message : String(err)}`
    );
    process.exit(1);
  } finally {
    closeDb();
  }
}
