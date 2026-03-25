import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { extractIssueRefs, IssueRef } from "./platform-detector.js";
import { GitHubClient, GitHubIssue } from "./github-client.js";
import { GitLabClient, GitLabIssue } from "./gitlab-client.js";
import { RemoteInfo, Platform } from "../git/remote-detector.js";
import { EventStore } from "../db/event-store.js";
import {
  DecisionEvent,
  EventType,
  IntentConfidence,
  IntentSource,
} from "../core/types.js";
import { ISSUE_SIGNALS } from "../core/signal-weights.js";
import { logger } from "../shared/logger.js";

export interface EnrichmentResult {
  issuesFound: number;
  issuesFetched: number;
  issuesUnreachable: number;
  wontFixCount: number;
  eventsCreated: number;
}

export interface IssueEnrichment {
  issueRef: string;
  platform: Platform;
  title: string;
  body: string | null;
  status: string;
  labels: string[];
  isFreezeSignal: boolean;
  freezeBoost: number;
  hasReproSteps: boolean;
  hasPlatformLabel: boolean;
  hasReviewComments: boolean;
}

/**
 * Enrich decision events with issue tracker context.
 *
 * Per Aranda & Venolia [3]: 23% of bug fixes had no link from bug record to
 * source code. Fetching issue context recovers domain-level signals that
 * predict architectural dependencies (Aryani et al. [9]).
 */
export class IssueEnricher {
  constructor(
    private db: Database.Database,
    private remote: RemoteInfo
  ) {}

  /**
   * Scan all events for a repo, find issue references,
   * fetch issue details, and emit ISSUE_ENRICHED events.
   */
  async enrichRepo(
    repoPath: string,
    onProgress?: (current: number, total: number) => void
  ): Promise<EnrichmentResult> {
    const eventStore = new EventStore(this.db);

    // Collect unique issue refs from all commit messages
    const allEvents = this.db
      .prepare(
        `SELECT DISTINCT commit_sha, commit_message
         FROM decision_events
         WHERE repo_path = ? AND commit_message IS NOT NULL`
      )
      .all(repoPath) as { commit_sha: string; commit_message: string }[];

    const issueMap = new Map<string, { sha: string; ref: IssueRef }[]>();

    for (const row of allEvents) {
      const refs = extractIssueRefs(row.commit_message);
      for (const ref of refs) {
        // Only process simple #N refs for GitHub/GitLab, and PROJ-N for Jira
        if (ref.type === "ticket" && this.remote.platform !== "jira") continue;
        if (ref.type === "issue" && ref.prefix !== "") continue; // Skip cross-repo

        const key = ref.raw;
        const existing = issueMap.get(key) ?? [];
        existing.push({ sha: row.commit_sha, ref });
        issueMap.set(key, existing);
      }
    }

    const result: EnrichmentResult = {
      issuesFound: issueMap.size,
      issuesFetched: 0,
      issuesUnreachable: 0,
      wontFixCount: 0,
      eventsCreated: 0,
    };

    if (issueMap.size === 0) {
      logger.info("No issue references found in commit messages");
      return result;
    }

    logger.info(`Found ${issueMap.size} unique issue references`);

    // Check which issues are already enriched
    const alreadyEnriched = new Set(
      (
        this.db
          .prepare(
            `SELECT DISTINCT issue_ref FROM issue_enrichments WHERE repo_path = ?`
          )
          .all(repoPath) as { issue_ref: string }[]
      ).map((r) => r.issue_ref)
    );

    const toFetch = [...issueMap.entries()].filter(
      ([key]) => !alreadyEnriched.has(key)
    );

    if (toFetch.length === 0) {
      logger.info("All issues already enriched");
      return result;
    }

    logger.info(`Fetching ${toFetch.length} new issues from ${this.remote.platform}...`);

    let processed = 0;

    for (const [issueKey, commits] of toFetch) {
      processed++;
      onProgress?.(processed, toFetch.length);

      const ref = commits[0].ref;
      const enrichment = await this.fetchAndAnalyze(ref);

      if (enrichment) {
        result.issuesFetched++;

        // Store in issue_enrichments table
        this.db
          .prepare(
            `INSERT INTO issue_enrichments
              (id, repo_path, commit_sha, issue_ref, platform, issue_title,
               issue_body, issue_status, labels, is_freeze_signal, freeze_boost)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            randomUUID(),
            repoPath,
            commits[0].sha,
            issueKey,
            this.remote.platform,
            enrichment.title,
            enrichment.body,
            enrichment.status,
            JSON.stringify(enrichment.labels),
            enrichment.isFreezeSignal ? 1 : 0,
            enrichment.freezeBoost
          );

        if (enrichment.isFreezeSignal) {
          result.wontFixCount++;
        }

        // Emit ISSUE_ENRICHED events for all commits that reference this issue
        const enrichEvents: DecisionEvent[] = [];
        for (const { sha } of commits) {
          // Find affected functions from this commit
          const functions = this.db
            .prepare(
              `SELECT DISTINCT function_id, file_path, function_name
               FROM decision_events
               WHERE commit_sha = ? AND repo_path = ? AND function_id IS NOT NULL`
            )
            .all(sha, repoPath) as {
            function_id: string;
            file_path: string;
            function_name: string;
          }[];

          for (const fn of functions) {
            const intentParts = [`Issue ${issueKey}: ${enrichment.title}.`];
            if (enrichment.isFreezeSignal) {
              intentParts.push("Resolved as Won't Fix / By Design.");
            }
            if (enrichment.hasReproSteps) {
              intentParts.push("Has reproduction steps.");
            }

            enrichEvents.push({
              repoPath,
              commitSha: sha,
              eventType: EventType.ISSUE_ENRICHED,
              functionId: fn.function_id,
              filePath: fn.file_path,
              functionName: fn.function_name,
              commitMessage: null,
              author: null,
              authoredAt: null,
              classification: null,
              intent: intentParts.join(" "),
              intentSource: IntentSource.ISSUE,
              confidence: IntentConfidence.ISSUE_ENRICHED,
              metadata: {
                issueRef: issueKey,
                platform: this.remote.platform,
                isFreezeSignal: enrichment.isFreezeSignal,
                freezeBoost: enrichment.freezeBoost,
                hasReproSteps: enrichment.hasReproSteps,
                hasPlatformLabel: enrichment.hasPlatformLabel,
                hasReviewComments: enrichment.hasReviewComments,
              },
            });
          }
        }

        if (enrichEvents.length > 0) {
          eventStore.appendEvents(enrichEvents);
          result.eventsCreated += enrichEvents.length;
        }
      } else {
        result.issuesUnreachable++;

        // Store as unreachable — still a signal per Aranda [3]
        this.db
          .prepare(
            `INSERT INTO issue_enrichments
              (id, repo_path, commit_sha, issue_ref, platform, issue_status,
               is_freeze_signal, freeze_boost)
             VALUES (?, ?, ?, ?, ?, 'unreachable', 0, ?)`
          )
          .run(
            randomUUID(),
            repoPath,
            commits[0].sha,
            issueKey,
            this.remote.platform,
            ISSUE_SIGNALS.issueUnreachable
          );
      }

      // Rate limiting: 100ms between requests
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    return result;
  }

  /**
   * Fetch a single issue and analyze its signals.
   */
  private async fetchAndAnalyze(ref: IssueRef): Promise<IssueEnrichment | null> {
    if (this.remote.platform === "github") {
      return this.fetchGitHub(ref);
    }
    if (this.remote.platform === "gitlab") {
      return this.fetchGitLab(ref);
    }

    // Unsupported platform
    return null;
  }

  private async fetchGitHub(ref: IssueRef): Promise<IssueEnrichment | null> {
    const client = new GitHubClient(
      this.remote.owner,
      this.remote.repo,
      this.remote.baseUrl
    );

    const issue = await client.fetchIssue(ref.number);
    if (!issue) return null;

    const isFreezeSignal = GitHubClient.isWontFix(issue);
    const hasReproSteps = GitHubClient.hasReproSteps(issue);
    const hasPlatformLabel = GitHubClient.hasPlatformLabel(issue);

    let freezeBoost = 0;
    if (isFreezeSignal) freezeBoost += ISSUE_SIGNALS.wontFixByDesign;
    if (hasReproSteps) freezeBoost += ISSUE_SIGNALS.reproductionSteps;
    if (hasPlatformLabel) freezeBoost += ISSUE_SIGNALS.platformSpecificLabel;
    if (issue.reviewComments > 0) freezeBoost += ISSUE_SIGNALS.prReviewComments;

    return {
      issueRef: ref.raw,
      platform: "github",
      title: issue.title,
      body: issue.body,
      status: issue.state,
      labels: issue.labels,
      isFreezeSignal,
      freezeBoost,
      hasReproSteps,
      hasPlatformLabel,
      hasReviewComments: issue.reviewComments > 0,
    };
  }

  private async fetchGitLab(ref: IssueRef): Promise<IssueEnrichment | null> {
    const client = new GitLabClient(
      this.remote.owner,
      this.remote.repo,
      this.remote.baseUrl
    );

    const issue = await client.fetchIssue(ref.number);
    if (!issue) return null;

    const isFreezeSignal = GitLabClient.isWontFix(issue);

    let freezeBoost = 0;
    if (isFreezeSignal) freezeBoost += ISSUE_SIGNALS.wontFixByDesign;

    return {
      issueRef: ref.raw,
      platform: "gitlab",
      title: issue.title,
      body: issue.description,
      status: issue.state,
      labels: issue.labels,
      isFreezeSignal,
      freezeBoost,
      hasReproSteps: false,
      hasPlatformLabel: false,
      hasReviewComments: false,
    };
  }
}
