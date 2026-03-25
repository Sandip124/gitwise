import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  existsSync,
  writeFileSync,
  readFileSync,
  lstatSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { getPool, closePool } from "../../db/pool.js";
import { runMigrations } from "../../db/migrator.js";
import { runInitPipeline } from "../../pipeline/init-pipeline.js";
import { logger } from "../../shared/logger.js";
import { redactDbUrl } from "../../shared/config.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, "..");

const CLAUDE_MD_RULES = `
## gitwise — Decision Protection Rules

This repository is indexed by **gitwise**, which tracks the intent behind code
decisions using git history. Before modifying any file, the AI agent MUST:

1. **ALWAYS call \`get_file_decisions\`** before editing any source file to see
   the decision manifest — which functions are FROZEN, STABLE, or OPEN.

2. **NEVER modify FROZEN functions** (score ≥ 0.80) without explicit user
   approval. These contain verified, intentional decisions backed by git history.

3. **Exercise caution with STABLE functions** (score 0.50–0.79). Review the
   intent history and explain why the change is safe before proceeding.

4. **OPEN functions** (score < 0.50) can be freely modified.

5. When the manifest shows a **THEORY GAP**, treat all logic as intentional
   pending manual review.

6. If you need to understand why code exists the way it does, call
   \`search_decisions\` with relevant keywords to find past decision context.
`.trim();

/**
 * Check that a path is not a symlink before writing.
 * Prevents symlink-based write redirection attacks.
 */
function safeToWrite(filePath: string): boolean {
  if (!existsSync(filePath)) return true; // New file — safe
  try {
    const stat = lstatSync(filePath);
    return !stat.isSymbolicLink();
  } catch {
    return false;
  }
}

export async function setupCommand(options: {
  path?: string;
  skipIndex?: boolean;
  global?: boolean;
}): Promise<void> {
  const repoPath = resolve(options.path ?? process.cwd());
  const gitwisePath = resolve(__dirname, "../../../");

  // Step 1: Verify it's a git repo
  console.log("Setting up gitwise...\n");

  if (!existsSync(resolve(repoPath, ".git"))) {
    console.error(`Error: ${repoPath} is not a git repository.`);
    process.exit(1);
  }
  console.log(`  ✓ Git repository: ${repoPath}`);

  // Step 2: Check Docker + PostgreSQL
  const dbUrl =
    process.env.DATABASE_URL ??
    "postgresql://gitwise:gitwise@localhost:5433/gitwise";

  let dbReady = false;
  try {
    const pool = getPool();
    await pool.query("SELECT 1");
    dbReady = true;
    console.log("  ✓ PostgreSQL connected");
  } catch {
    // Redact credentials before logging
    console.log("  ⚠ PostgreSQL not reachable at " + redactDbUrl(dbUrl));
    console.log(
      "    Run: docker compose -f <gitwise-path>/docker-compose.yml up -d"
    );
  }

  // Step 3: Run migrations if DB is available
  if (dbReady) {
    try {
      const pool = getPool();
      await runMigrations(pool);
      console.log("  ✓ Database migrations applied");
    } catch (err) {
      console.log(
        "  ⚠ Migration failed: " +
          (err instanceof Error ? err.message : String(err))
      );
    }
  }

  // Step 4: Create .mcp.json for Claude Code
  // Use env var reference instead of literal DB URL to avoid credential leakage
  const mcpConfigPath = resolve(repoPath, ".mcp.json");
  const mcpConfig = {
    gitwise: {
      command: "npx",
      args: ["gitwise-mcp", "serve"],
      env: {
        DATABASE_URL: "${DATABASE_URL}",
      },
    },
  };

  if (safeToWrite(mcpConfigPath)) {
    if (existsSync(mcpConfigPath)) {
      try {
        const existing = JSON.parse(readFileSync(mcpConfigPath, "utf-8"));
        if (typeof existing === "object" && existing !== null && !Array.isArray(existing)) {
          existing.gitwise = mcpConfig.gitwise;
          writeFileSync(mcpConfigPath, JSON.stringify(existing, null, 2) + "\n");
          console.log("  ✓ Updated .mcp.json (merged with existing)");
        }
      } catch {
        writeFileSync(mcpConfigPath, JSON.stringify(mcpConfig, null, 2) + "\n");
        console.log("  ✓ Created .mcp.json");
      }
    } else {
      writeFileSync(mcpConfigPath, JSON.stringify(mcpConfig, null, 2) + "\n");
      console.log("  ✓ Created .mcp.json");
    }
  } else {
    console.log("  ⚠ Skipped .mcp.json (path is a symlink)");
  }

  // Step 5: Add gitwise rules to CLAUDE.md
  const claudeMdPath = resolve(repoPath, "CLAUDE.md");
  if (safeToWrite(claudeMdPath)) {
    if (existsSync(claudeMdPath)) {
      const existing = readFileSync(claudeMdPath, "utf-8");
      if (existing.includes("gitwise")) {
        console.log("  ✓ CLAUDE.md already contains gitwise rules");
      } else {
        writeFileSync(
          claudeMdPath,
          existing + "\n\n" + CLAUDE_MD_RULES + "\n"
        );
        console.log("  ✓ Appended gitwise rules to CLAUDE.md");
      }
    } else {
      writeFileSync(claudeMdPath, CLAUDE_MD_RULES + "\n");
      console.log("  ✓ Created CLAUDE.md with gitwise rules");
    }
  } else {
    console.log("  ⚠ Skipped CLAUDE.md (path is a symlink)");
  }

  // Step 6: Add .mcp.json to .gitignore (contains local paths)
  const gitignorePath = resolve(repoPath, ".gitignore");
  if (safeToWrite(gitignorePath) && existsSync(gitignorePath)) {
    const gitignore = readFileSync(gitignorePath, "utf-8");
    if (!gitignore.includes(".mcp.json")) {
      writeFileSync(gitignorePath, gitignore.trimEnd() + "\n.mcp.json\n");
      console.log("  ✓ Added .mcp.json to .gitignore");
    }
  }

  // Step 7: Index the repository
  if (!options.skipIndex && dbReady) {
    console.log("\n  Indexing git history...");
    try {
      const pool = getPool();
      const result = await runInitPipeline({
        repoPath,
        pool,
        fullHistory: true,
        onProgress: (current, total, sha) => {
          if (current % 50 === 0 || current === total) {
            process.stderr.write(
              `\r    Processing commit ${current}/${total} (${sha.slice(0, 7)})...`
            );
          }
        },
      });
      process.stderr.write("\n");
      console.log(
        `  ✓ Indexed: ${result.commitsProcessed} commits, ${result.eventsCreated} events, ${result.functionsTracked} functions`
      );
    } catch (err) {
      console.log(
        "  ⚠ Indexing failed: " +
          (err instanceof Error ? err.message : String(err))
      );
    }
  } else if (!dbReady) {
    console.log("\n  ⚠ Skipping indexing (database not available)");
  }

  // Step 8: Register globally with Claude Code (optional)
  // Uses execFileSync to avoid shell injection via path metacharacters
  if (options.global) {
    try {
      execFileSync("claude", [
        "mcp",
        "add",
        "gitwise",
        "-e",
        `DATABASE_URL=${dbUrl}`,
        "--",
        "npx",
        "gitwise-mcp",
        "serve",
      ], { stdio: "pipe" });
      console.log("  ✓ Registered gitwise globally with Claude Code");
    } catch {
      console.log("  ⚠ Could not register globally (claude CLI not found)");
      console.log(
        "    Run manually: claude mcp add gitwise -e DATABASE_URL=... -- npx gitwise-mcp serve"
      );
    }
  }

  // Summary
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("Setup complete! Claude Code will now:");
  console.log("  1. See gitwise MCP tools (via .mcp.json)");
  console.log("  2. Follow decision protection rules (via CLAUDE.md)");
  console.log("  3. Call get_file_decisions before editing files");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  await closePool();
}
