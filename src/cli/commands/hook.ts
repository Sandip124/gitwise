import {
  writeFileSync,
  chmodSync,
  existsSync,
  unlinkSync,
  lstatSync,
  realpathSync,
} from "node:fs";
import { resolve, join } from "node:path";

const POST_COMMIT_HOOK = `#!/bin/sh
# wisegit post-commit hook — index the latest commit
wisegit init --path "$(git rev-parse --show-toplevel)" 2>/dev/null || true
`;

const POST_MERGE_HOOK = `#!/bin/sh
# wisegit post-merge hook — capture branch context at merge time
wisegit branch-capture --path "$(git rev-parse --show-toplevel)" 2>/dev/null || true
`;

/**
 * Verify a path is safe to write to:
 * - Not a symlink (prevents write redirection)
 * - Resolves within the expected parent directory
 */
function isSafeHookPath(hookPath: string, expectedParent: string): boolean {
  if (!existsSync(hookPath)) return true; // New file — safe

  try {
    const stat = lstatSync(hookPath);
    if (stat.isSymbolicLink()) {
      console.error(
        `Error: ${hookPath} is a symlink. Refusing to write for security.`
      );
      return false;
    }
    // Verify resolved path is under the expected hooks directory
    const real = realpathSync(hookPath);
    if (!real.startsWith(realpathSync(expectedParent))) {
      console.error(`Error: ${hookPath} resolves outside expected directory.`);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export async function hookCommand(
  action: string,
  options: { path?: string }
): Promise<void> {
  const repoPath = resolve(options.path ?? process.cwd());
  const hooksDir = join(repoPath, ".git", "hooks");

  if (!existsSync(hooksDir)) {
    console.error(
      `Error: ${hooksDir} does not exist. Is this a git repository?`
    );
    process.exit(1);
  }

  const hookPath = join(hooksDir, "post-commit");

  if (action === "install") {
    if (existsSync(hookPath)) {
      console.log(`Hook already exists at ${hookPath}. Skipping.`);
      return;
    }

    if (!isSafeHookPath(hookPath, hooksDir)) {
      process.exit(1);
    }

    writeFileSync(hookPath, POST_COMMIT_HOOK, "utf-8");
    chmodSync(hookPath, "755");
    console.log(`Installed post-commit hook at ${hookPath}`);

    // Also install post-merge hook for branch context capture
    const mergeHookPath = join(hooksDir, "post-merge");
    if (!existsSync(mergeHookPath) && isSafeHookPath(mergeHookPath, hooksDir)) {
      writeFileSync(mergeHookPath, POST_MERGE_HOOK, "utf-8");
      chmodSync(mergeHookPath, "755");
      console.log(`Installed post-merge hook at ${mergeHookPath}`);
    }
  } else if (action === "uninstall") {
    if (!existsSync(hookPath)) {
      console.log("No post-commit hook found. Nothing to remove.");
      return;
    }

    if (!isSafeHookPath(hookPath, hooksDir)) {
      process.exit(1);
    }

    unlinkSync(hookPath);
    console.log(`Removed post-commit hook from ${hookPath}`);

    // Also remove post-merge hook
    const mergeHookPath = join(hooksDir, "post-merge");
    if (existsSync(mergeHookPath) && isSafeHookPath(mergeHookPath, hooksDir)) {
      unlinkSync(mergeHookPath);
      console.log(`Removed post-merge hook from ${mergeHookPath}`);
    }
  } else {
    console.error(`Unknown action: ${action}. Use "install" or "uninstall".`);
    process.exit(1);
  }
}
