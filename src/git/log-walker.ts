import { simpleGit, SimpleGit } from "simple-git";
import { CommitInfo } from "../core/types.js";
import { logger } from "../shared/logger.js";
import { NotAGitRepoError } from "../shared/errors.js";

/**
 * Walk git log and yield commit info with diffs.
 *
 * Supports two modes:
 * - Full history: all commits oldest→newest (for gitwise init)
 * - Incremental: just the latest commit (for post-commit hook)
 */
export class LogWalker {
  private git: SimpleGit;

  constructor(private repoPath: string) {
    this.git = simpleGit(repoPath);
  }

  async validate(): Promise<void> {
    const isRepo = await this.git.checkIsRepo();
    if (!isRepo) {
      throw new NotAGitRepoError(this.repoPath);
    }
  }

  /**
   * Get all commits oldest→newest.
   */
  async getAllCommits(): Promise<CommitInfo[]> {
    const log = await this.git.log(["--reverse", "--all"]);

    return log.all.map((entry) => ({
      sha: entry.hash,
      message: entry.message,
      author: entry.author_name,
      authorEmail: entry.author_email,
      date: new Date(entry.date),
      parentSha: null, // Will be resolved per-commit
    }));
  }

  /**
   * Get the diff for a specific commit as raw text.
   */
  async getCommitDiff(sha: string): Promise<string> {
    try {
      // For root commits (no parent), diff against empty tree
      const result = await this.git.raw([
        "diff-tree",
        "-p",
        "--no-commit-id",
        "-r",
        sha,
      ]);
      return result;
    } catch {
      // Root commit fallback
      try {
        const result = await this.git.raw([
          "diff-tree",
          "-p",
          "--root",
          sha,
        ]);
        return result;
      } catch {
        logger.warn(`Could not get diff for commit ${sha}`);
        return "";
      }
    }
  }

  /**
   * Get file content at a specific commit.
   */
  async getFileAtCommit(sha: string, filePath: string): Promise<string | null> {
    try {
      return await this.git.show([`${sha}:${filePath}`]);
    } catch {
      return null;
    }
  }

  /**
   * Get the parent SHA for a commit.
   */
  async getParentSha(sha: string): Promise<string | null> {
    try {
      const result = await this.git.raw(["rev-parse", `${sha}^`]);
      return result.trim() || null;
    } catch {
      return null; // Root commit
    }
  }

  /**
   * Get the latest commit SHA.
   */
  async getLatestCommit(): Promise<CommitInfo | null> {
    const log = await this.git.log(["-1"]);
    if (log.all.length === 0) return null;

    const entry = log.all[0];
    return {
      sha: entry.hash,
      message: entry.message,
      author: entry.author_name,
      authorEmail: entry.author_email,
      date: new Date(entry.date),
      parentSha: null,
    };
  }

  /**
   * Get total commit count (for progress reporting).
   */
  async getCommitCount(): Promise<number> {
    const result = await this.git.raw(["rev-list", "--count", "--all"]);
    return parseInt(result.trim(), 10);
  }

  /**
   * Get the repo root path.
   */
  async getRepoRoot(): Promise<string> {
    const root = await this.git.revparse(["--show-toplevel"]);
    return root.trim();
  }
}
