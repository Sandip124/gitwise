import { logger } from "../shared/logger.js";

export interface GitLabIssue {
  iid: number;
  title: string;
  description: string | null;
  state: string;           // "opened" | "closed"
  labels: string[];
  comments: { author: string; body: string }[];
}

/**
 * Fetch issue details from GitLab REST API (v4).
 * Auth: uses GITLAB_TOKEN env var.
 */
export class GitLabClient {
  private baseUrl: string;
  private projectPath: string;
  private token: string | null;

  constructor(owner: string, repo: string, baseUrl: string) {
    this.projectPath = encodeURIComponent(`${owner}/${repo}`);
    this.baseUrl = baseUrl;
    this.token = process.env.GITLAB_TOKEN ?? null;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = {};
    if (this.token) {
      h["PRIVATE-TOKEN"] = this.token;
    }
    return h;
  }

  async fetchIssue(number: number): Promise<GitLabIssue | null> {
    try {
      const res = await fetch(
        `${this.baseUrl}/projects/${this.projectPath}/issues/${number}`,
        { headers: this.headers() }
      );

      if (!res.ok) return null;

      const issue = (await res.json()) as Record<string, unknown>;

      // Fetch notes (comments)
      const comments: { author: string; body: string }[] = [];
      try {
        const notesRes = await fetch(
          `${this.baseUrl}/projects/${this.projectPath}/issues/${number}/notes?per_page=30`,
          { headers: this.headers() }
        );
        if (notesRes.ok) {
          const notes = (await notesRes.json()) as Record<string, unknown>[];
          for (const n of notes) {
            if (n.system) continue; // Skip system notes
            const author = n.author as Record<string, unknown> | null;
            comments.push({
              author: (author?.username as string) ?? "unknown",
              body: (n.body as string) ?? "",
            });
          }
        }
      } catch {
        // Continue without comments
      }

      return {
        iid: number,
        title: (issue.title as string) ?? "",
        description: (issue.description as string) ?? null,
        state: (issue.state as string) ?? "unknown",
        labels: (issue.labels as string[]) ?? [],
        comments,
      };
    } catch (err) {
      logger.warn(
        `Failed to fetch GitLab issue #${number}: ${err instanceof Error ? err.message : String(err)}`
      );
      return null;
    }
  }

  static isWontFix(issue: GitLabIssue): boolean {
    const wontFixLabels = [
      "wontfix", "won't fix", "by design", "not a bug", "duplicate",
    ];
    for (const label of issue.labels) {
      if (wontFixLabels.includes(label.toLowerCase())) return true;
    }
    return false;
  }
}
