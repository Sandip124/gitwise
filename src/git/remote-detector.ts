import { simpleGit } from "simple-git";
import { logger } from "../shared/logger.js";

export type Platform = "github" | "gitlab" | "azure" | "bitbucket" | "jira" | "unknown";

export interface RemoteInfo {
  platform: Platform;
  owner: string;
  repo: string;
  baseUrl: string;
}

/**
 * Detect the hosting platform from git remote URL.
 * Supports HTTPS and SSH formats for GitHub, GitLab, Azure DevOps, Bitbucket.
 */
export async function detectRemote(repoPath: string): Promise<RemoteInfo | null> {
  try {
    const git = simpleGit(repoPath);
    const remotes = await git.getRemotes(true);

    const origin = remotes.find((r) => r.name === "origin");
    if (!origin?.refs?.fetch) return null;

    return parseRemoteUrl(origin.refs.fetch);
  } catch {
    logger.warn("Could not detect git remote");
    return null;
  }
}

export function parseRemoteUrl(url: string): RemoteInfo | null {
  // GitHub HTTPS: https://github.com/owner/repo.git
  // GitHub SSH:   git@github.com:owner/repo.git
  const github = url.match(
    /github\.com[:/]([^/]+)\/([^/.]+?)(?:\.git)?$/
  );
  if (github) {
    return {
      platform: "github",
      owner: github[1],
      repo: github[2],
      baseUrl: "https://api.github.com",
    };
  }

  // GitLab HTTPS: https://gitlab.com/owner/repo.git
  // GitLab SSH:   git@gitlab.com:owner/repo.git
  // Self-hosted:  https://gitlab.example.com/owner/repo.git
  const gitlab = url.match(
    /gitlab[^/]*[:/]([^/]+)\/([^/.]+?)(?:\.git)?$/
  );
  if (gitlab) {
    const host = url.match(/https?:\/\/([^/]+)/)?.[1] ?? "gitlab.com";
    return {
      platform: "gitlab",
      owner: gitlab[1],
      repo: gitlab[2],
      baseUrl: `https://${host}/api/v4`,
    };
  }

  // Azure DevOps HTTPS: https://dev.azure.com/org/project/_git/repo
  // Azure SSH:          git@ssh.dev.azure.com:v3/org/project/repo
  const azure = url.match(
    /dev\.azure\.com\/([^/]+)\/([^/]+)\/_git\/([^/.]+)/
  );
  if (azure) {
    return {
      platform: "azure",
      owner: azure[1],
      repo: azure[3],
      baseUrl: `https://dev.azure.com/${azure[1]}/${azure[2]}`,
    };
  }

  // Bitbucket HTTPS: https://bitbucket.org/owner/repo.git
  const bitbucket = url.match(
    /bitbucket\.org[:/]([^/]+)\/([^/.]+?)(?:\.git)?$/
  );
  if (bitbucket) {
    return {
      platform: "bitbucket",
      owner: bitbucket[1],
      repo: bitbucket[2],
      baseUrl: "https://api.bitbucket.org/2.0",
    };
  }

  return null;
}
