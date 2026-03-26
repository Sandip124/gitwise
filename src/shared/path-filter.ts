import { existsSync, readFileSync } from "node:fs";
import { getWisegitPaths, TeamConfig, DEFAULT_TEAM_CONFIG } from "./team-types.js";

/**
 * Load ignore_paths from .wisegit/config.json.
 */
export function loadIgnorePaths(repoPath: string): string[] {
  try {
    const paths = getWisegitPaths(repoPath);
    if (existsSync(paths.config)) {
      const config = JSON.parse(readFileSync(paths.config, "utf-8")) as TeamConfig;
      return config.ignore_paths ?? DEFAULT_TEAM_CONFIG.ignore_paths;
    }
  } catch {
    // fallback
  }
  return DEFAULT_TEAM_CONFIG.ignore_paths;
}

/**
 * Check if a file path should be ignored based on ignore_paths config.
 *
 * Matches:
 * - Prefix: "Forms/" matches "Forms/Dashboard.cs"
 * - Contains: "*.Designer.cs" matches "Forms/Dashboard.Designer.cs"
 * - Glob-like: patterns ending with "/" match directory prefixes
 */
export function shouldIgnorePath(
  filePath: string,
  ignorePaths: string[]
): boolean {
  for (const pattern of ignorePaths) {
    // Wildcard pattern: *.Designer.cs
    if (pattern.startsWith("*")) {
      const suffix = pattern.slice(1);
      if (filePath.endsWith(suffix)) return true;
      continue;
    }

    // Directory prefix: Forms/, vendor/
    if (pattern.endsWith("/")) {
      if (filePath.startsWith(pattern) || filePath.includes(`/${pattern}`)) return true;
      continue;
    }

    // Exact match or contains
    if (filePath === pattern || filePath.startsWith(pattern) || filePath.includes(`/${pattern}`)) {
      return true;
    }
  }

  return false;
}
