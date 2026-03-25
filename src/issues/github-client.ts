import { logger } from "../shared/logger.js";

export interface GitHubIssue {
  number: number;
  title: string;
  body: string | null;
  state: string;            // "open" | "closed"
  stateReason: string | null; // "completed" | "not_planned" | "reopened"
  labels: string[];
  isPR: boolean;
  comments: GitHubComment[];
  reviewComments: number;
}

export interface GitHubComment {
  author: string;
  body: string;
  createdAt: string;
}

/**
 * Fetch issue/PR details from GitHub REST API.
 *
 * Auth: uses GITHUB_TOKEN or GH_TOKEN env var.
 * Rate limit: 5000 req/hr authenticated, 60 unauthenticated.
 */
export class GitHubClient {
  private baseUrl: string;
  private owner: string;
  private repo: string;
  private token: string | null;

  constructor(owner: string, repo: string, baseUrl = "https://api.github.com") {
    this.owner = owner;
    this.repo = repo;
    this.baseUrl = baseUrl;
    this.token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? null;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    };
    if (this.token) {
      h.Authorization = `Bearer ${this.token}`;
    }
    return h;
  }

  async fetchIssue(number: number): Promise<GitHubIssue | null> {
    try {
      // Fetch issue/PR
      const issueRes = await fetch(
        `${this.baseUrl}/repos/${this.owner}/${this.repo}/issues/${number}`,
        { headers: this.headers() }
      );

      if (!issueRes.ok) {
        if (issueRes.status === 404) return null;
        if (issueRes.status === 403) {
          logger.warn(`GitHub rate limit hit for #${number}`);
          return null;
        }
        return null;
      }

      const issue = (await issueRes.json()) as Record<string, unknown>;

      // Fetch comments (up to 30)
      const comments: GitHubComment[] = [];
      try {
        const commentsRes = await fetch(
          `${this.baseUrl}/repos/${this.owner}/${this.repo}/issues/${number}/comments?per_page=30`,
          { headers: this.headers() }
        );

        if (commentsRes.ok) {
          const rawComments = (await commentsRes.json()) as Record<string, unknown>[];
          for (const c of rawComments) {
            const user = c.user as Record<string, unknown> | null;
            comments.push({
              author: (user?.login as string) ?? "unknown",
              body: (c.body as string) ?? "",
              createdAt: c.created_at as string,
            });
          }
        }
      } catch {
        // Comments fetch failed — continue without them
      }

      const labels = ((issue.labels as Record<string, unknown>[]) ?? []).map(
        (l) => (typeof l === "string" ? l : (l.name as string) ?? "")
      );

      return {
        number,
        title: (issue.title as string) ?? "",
        body: (issue.body as string) ?? null,
        state: (issue.state as string) ?? "unknown",
        stateReason: (issue.state_reason as string) ?? null,
        labels,
        isPR: issue.pull_request !== undefined,
        comments,
        reviewComments: 0,
      };
    } catch (err) {
      logger.warn(
        `Failed to fetch GitHub issue #${number}: ${err instanceof Error ? err.message : String(err)}`
      );
      return null;
    }
  }

  /**
   * Detect if an issue was closed as "won't fix" or "by design".
   */
  static isWontFix(issue: GitHubIssue): boolean {
    // GitHub state_reason "not_planned" = Won't Fix
    if (issue.stateReason === "not_planned") return true;

    // Check labels
    const wontFixLabels = [
      "wontfix",
      "won't fix",
      "wont-fix",
      "by design",
      "by-design",
      "not a bug",
      "not-a-bug",
      "intended",
      "working as intended",
      "duplicate",
    ];
    for (const label of issue.labels) {
      if (wontFixLabels.includes(label.toLowerCase())) return true;
    }

    // Check comments for explicit "won't fix" / "by design" statements
    const wontFixPhrases = [
      "won't fix",
      "wont fix",
      "by design",
      "working as intended",
      "this is intentional",
      "not a bug",
      "intended behavior",
      "intended behaviour",
    ];
    for (const comment of issue.comments) {
      const lower = comment.body.toLowerCase();
      for (const phrase of wontFixPhrases) {
        if (lower.includes(phrase)) return true;
      }
    }

    return false;
  }

  /**
   * Check if issue has reproduction steps.
   */
  static hasReproSteps(issue: GitHubIssue): boolean {
    const body = (issue.body ?? "").toLowerCase();
    return (
      body.includes("steps to reproduce") ||
      body.includes("reproduction steps") ||
      body.includes("how to reproduce") ||
      body.includes("repro steps") ||
      body.includes("to reproduce")
    );
  }

  /**
   * Check if issue has platform-specific labels.
   */
  static hasPlatformLabel(issue: GitHubIssue): boolean {
    const platformKeywords = [
      "ios",
      "android",
      "windows",
      "macos",
      "linux",
      "safari",
      "chrome",
      "firefox",
      "edge",
      "mobile",
      "desktop",
      "arm",
      "x86",
    ];
    for (const label of issue.labels) {
      const lower = label.toLowerCase();
      for (const kw of platformKeywords) {
        if (lower.includes(kw)) return true;
      }
    }
    return false;
  }
}
