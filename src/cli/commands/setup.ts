import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  existsSync,
  writeFileSync,
  readFileSync,
  lstatSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { getDb, closeDb } from "../../db/database.js";
import { runMigrations } from "../../db/migrator.js";
import { runInitPipeline } from "../../pipeline/init-pipeline.js";
import { logger } from "../../shared/logger.js";

const CLAUDE_MD_RULES = `
## wisegit — Decision Protection Rules

This repository is indexed by **wisegit**, which tracks the intent behind code
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

function safeToWrite(filePath: string): boolean {
  if (!existsSync(filePath)) return true;
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

  console.log("Setting up wisegit...\n");

  if (!existsSync(resolve(repoPath, ".git"))) {
    console.error(`Error: ${repoPath} is not a git repository.`);
    process.exit(1);
  }
  console.log(`  \u2713 Git repository: ${repoPath}`);

  // Initialize SQLite database (auto-creates ~/.wisegit/wisegit.db)
  const db = getDb();
  runMigrations(db);
  console.log("  \u2713 Database ready (SQLite)");

  // Create .mcp.json for Claude Code
  const mcpConfigPath = resolve(repoPath, ".mcp.json");
  const mcpConfig = {
    wisegit: {
      command: "npx",
      args: ["wisegit", "serve"],
    },
  };

  if (safeToWrite(mcpConfigPath)) {
    if (existsSync(mcpConfigPath)) {
      try {
        const existing = JSON.parse(readFileSync(mcpConfigPath, "utf-8"));
        if (
          typeof existing === "object" &&
          existing !== null &&
          !Array.isArray(existing)
        ) {
          existing.wisegit = mcpConfig.wisegit;
          writeFileSync(
            mcpConfigPath,
            JSON.stringify(existing, null, 2) + "\n"
          );
          console.log("  \u2713 Updated .mcp.json (merged with existing)");
        }
      } catch {
        writeFileSync(
          mcpConfigPath,
          JSON.stringify(mcpConfig, null, 2) + "\n"
        );
        console.log("  \u2713 Created .mcp.json");
      }
    } else {
      writeFileSync(
        mcpConfigPath,
        JSON.stringify(mcpConfig, null, 2) + "\n"
      );
      console.log("  \u2713 Created .mcp.json");
    }
  } else {
    console.log("  \u26a0 Skipped .mcp.json (path is a symlink)");
  }

  // Add wisegit rules to CLAUDE.md
  const claudeMdPath = resolve(repoPath, "CLAUDE.md");
  if (safeToWrite(claudeMdPath)) {
    if (existsSync(claudeMdPath)) {
      const existing = readFileSync(claudeMdPath, "utf-8");
      if (existing.includes("wisegit")) {
        console.log("  \u2713 CLAUDE.md already contains wisegit rules");
      } else {
        writeFileSync(
          claudeMdPath,
          existing + "\n\n" + CLAUDE_MD_RULES + "\n"
        );
        console.log("  \u2713 Appended wisegit rules to CLAUDE.md");
      }
    } else {
      writeFileSync(claudeMdPath, CLAUDE_MD_RULES + "\n");
      console.log("  \u2713 Created CLAUDE.md with wisegit rules");
    }
  } else {
    console.log("  \u26a0 Skipped CLAUDE.md (path is a symlink)");
  }

  // Add .mcp.json to .gitignore
  const gitignorePath = resolve(repoPath, ".gitignore");
  if (safeToWrite(gitignorePath) && existsSync(gitignorePath)) {
    const gitignore = readFileSync(gitignorePath, "utf-8");
    if (!gitignore.includes(".mcp.json")) {
      writeFileSync(gitignorePath, gitignore.trimEnd() + "\n.mcp.json\n");
      console.log("  \u2713 Added .mcp.json to .gitignore");
    }
  }

  // Index the repository
  if (!options.skipIndex) {
    console.log("\n  Indexing git history...");
    try {
      const result = await runInitPipeline({
        repoPath,
        db,
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
        `  \u2713 Indexed: ${result.commitsProcessed} commits, ${result.eventsCreated} events, ${result.functionsTracked} functions`
      );
    } catch (err) {
      console.log(
        "  \u26a0 Indexing failed: " +
          (err instanceof Error ? err.message : String(err))
      );
    }
  }

  // Register globally with Claude Code (optional)
  if (options.global) {
    try {
      execFileSync(
        "claude",
        ["mcp", "add", "wisegit", "--", "npx", "wisegit", "serve"],
        { stdio: "pipe" }
      );
      console.log("  \u2713 Registered wisegit globally with Claude Code");
    } catch {
      console.log(
        "  \u26a0 Could not register globally (claude CLI not found)"
      );
      console.log(
        "    Run manually: claude mcp add wisegit -- npx wisegit serve"
      );
    }
  }

  console.log(
    "\n\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501"
  );
  console.log("Setup complete! Claude Code will now:");
  console.log("  1. See wisegit MCP tools (via .mcp.json)");
  console.log("  2. Follow decision protection rules (via CLAUDE.md)");
  console.log("  3. Call get_file_decisions before editing files");
  console.log(
    "\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501"
  );

  closeDb();
}
