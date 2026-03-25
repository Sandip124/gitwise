import { writeFileSync, chmodSync, existsSync, unlinkSync } from "node:fs";
import { resolve, join } from "node:path";

const POST_COMMIT_HOOK = `#!/bin/sh
# gitwise post-commit hook — index the latest commit
gitwise init --path "$(git rev-parse --show-toplevel)" 2>/dev/null || true
`;

export async function hookCommand(
  action: string,
  options: { path?: string }
): Promise<void> {
  const repoPath = resolve(options.path ?? process.cwd());
  const hooksDir = join(repoPath, ".git", "hooks");

  if (!existsSync(hooksDir)) {
    console.error(`Error: ${hooksDir} does not exist. Is this a git repository?`);
    process.exit(1);
  }

  const hookPath = join(hooksDir, "post-commit");

  if (action === "install") {
    if (existsSync(hookPath)) {
      console.log(`Hook already exists at ${hookPath}. Skipping.`);
      return;
    }

    writeFileSync(hookPath, POST_COMMIT_HOOK, "utf-8");
    chmodSync(hookPath, "755");
    console.log(`Installed post-commit hook at ${hookPath}`);
  } else if (action === "uninstall") {
    if (!existsSync(hookPath)) {
      console.log("No post-commit hook found. Nothing to remove.");
      return;
    }

    unlinkSync(hookPath);
    console.log(`Removed post-commit hook from ${hookPath}`);
  } else {
    console.error(`Unknown action: ${action}. Use "install" or "uninstall".`);
    process.exit(1);
  }
}
