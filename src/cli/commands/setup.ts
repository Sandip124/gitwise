import { resolve, dirname } from "node:path";
import {
  existsSync,
  writeFileSync,
  readFileSync,
  lstatSync,
  mkdirSync,
  chmodSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { getDb, closeDb } from "../../db/database.js";
import { runMigrations } from "../../db/migrator.js";
import { runInitPipeline } from "../../pipeline/init-pipeline.js";
import { runRecomputePipeline } from "../../pipeline/recompute-pipeline.js";
import { logger } from "../../shared/logger.js";
import {
  getWisegitPaths,
  DEFAULT_TEAM_CONFIG,
} from "../../shared/team-types.js";

const CLAUDE_MD_RULES = `
## wisegit — Decision Protection Rules

This repository is indexed by **wisegit**, which tracks the intent behind code
decisions using git history. Before modifying any file, the AI agent MUST:

1. **ALWAYS call \`get_file_decisions\`** before editing any source file to see
   the decision manifest — which functions are FROZEN, STABLE, or OPEN.

2. **NEVER modify FROZEN functions** (score ≥ 0.80) without an override.
   If the user asks you to modify a frozen function, call \`create_override\`
   first with a clear reason. The user will approve the override in the UI.

3. **Exercise caution with STABLE functions** (score 0.50–0.79). Review the
   intent history and explain why the change is safe before proceeding.

4. **OPEN functions** (score < 0.50) can be freely modified.

5. When the manifest shows a **THEORY GAP**, treat all logic as intentional
   pending manual review.

6. If you need to understand why code exists the way it does, call
   \`search_decisions\` with relevant keywords to find past decision context.

7. When the manifest shows **OVERRIDE**, the function is under active
   modification — proceed but note the override reason and expiry.
`.trim();

const HOOK_SCRIPT = `#!/bin/bash
# wisegit-check.sh
# PreToolUse hook — blocks Edit/Write on FROZEN functions
# Receives tool input as JSON via stdin

INPUT=$(cat)

# Extract the file path from the tool input
FILE=$(echo "$INPUT" | jq -r '.tool_input.path // empty')

if [ -z "$FILE" ]; then
  exit 0
fi

# Only check files that exist in the repo
if [ ! -f "$FILE" ]; then
  exit 0
fi

# Run wisegit audit and capture output + exit code
AUDIT=$(wisegit audit "$FILE" 2>&1)
AUDIT_EXIT=$?

# wisegit not installed or not initialized — warn but don't block
if [ $AUDIT_EXIT -ne 0 ] && echo "$AUDIT" | grep -qiE "not found|not initialized|no database"; then
  echo "⚠ wisegit: could not check $FILE — run 'wisegit init' to enable decision protection" >&2
  exit 0
fi

# Block on FROZEN functions (match manifest format exactly to avoid false positives)
if echo "$AUDIT" | grep -q "^FROZEN:"; then
  FROZEN_LINES=$(echo "$AUDIT" | grep "^FROZEN:")

  echo "" >&2
  echo "🚫 wisegit BLOCKED: $FILE contains FROZEN functions" >&2
  echo "" >&2
  echo "$FROZEN_LINES" >&2
  echo "" >&2
  echo "These functions have high freeze scores — modifying them risks breaking intentional decisions." >&2
  echo "To proceed, run: wisegit override <function> --reason \\"your reason here\\"" >&2
  echo "" >&2
  exit 2
fi

# Warn on STABLE functions but allow
if echo "$AUDIT" | grep -q "^STABLE:"; then
  STABLE_LINES=$(echo "$AUDIT" | grep "^STABLE:")

  echo "" >&2
  echo "⚠ wisegit WARNING: $FILE contains STABLE functions" >&2
  echo "" >&2
  echo "$STABLE_LINES" >&2
  echo "" >&2
  echo "Review the decision manifest before modifying these functions." >&2
  echo "Run: wisegit audit $FILE" >&2
  echo "" >&2
fi

exit 0
`;

function writeClaudeHooks(repoRoot: string): { hookCreated: boolean; settingsUpdated: boolean; hookSkipped: boolean; settingsSkipped: boolean } {
  const hookDir = resolve(repoRoot, ".claude", "hooks");
  const hookPath = resolve(hookDir, "wisegit-check.sh");
  const settingsPath = resolve(repoRoot, ".claude", "settings.json");

  let hookCreated = false;
  let settingsUpdated = false;
  let hookSkipped = false;
  let settingsSkipped = false;

  // Write .claude/hooks/wisegit-check.sh
  if (!existsSync(hookPath)) {
    mkdirSync(hookDir, { recursive: true });
    writeFileSync(hookPath, HOOK_SCRIPT);
    chmodSync(hookPath, 0o755);
    hookCreated = true;
  } else {
    hookSkipped = true;
  }

  // Write or merge .claude/settings.json
  const wisegitHookEntry = {
    matcher: "Edit|Write",
    hooks: [
      {
        type: "command",
        command: ".claude/hooks/wisegit-check.sh",
      },
    ],
  };

  if (!existsSync(settingsPath)) {
    mkdirSync(dirname(settingsPath), { recursive: true });
    const settings = {
      hooks: {
        PreToolUse: [wisegitHookEntry],
      },
    };
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
    settingsUpdated = true;
  } else {
    try {
      const raw = readFileSync(settingsPath, "utf-8");
      const settings = JSON.parse(raw);

      if (!settings.hooks) {
        settings.hooks = {};
      }
      if (!Array.isArray(settings.hooks.PreToolUse)) {
        settings.hooks.PreToolUse = [];
      }

      // Check if wisegit hook already registered
      const alreadyExists = settings.hooks.PreToolUse.some(
        (entry: Record<string, unknown>) =>
          Array.isArray(entry.hooks) &&
          entry.hooks.some(
            (h: Record<string, unknown>) => h.command === ".claude/hooks/wisegit-check.sh"
          )
      );

      if (!alreadyExists) {
        settings.hooks.PreToolUse.push(wisegitHookEntry);
        writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
        settingsUpdated = true;
      } else {
        settingsSkipped = true;
      }
    } catch {
      logger.warn("Could not parse .claude/settings.json — skipping hook merge");
      settingsSkipped = true;
    }
  }

  return { hookCreated, settingsUpdated, hookSkipped, settingsSkipped };
}

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

  // Create .wisegit/ shared directory + config.json
  const paths = getWisegitPaths(repoPath);
  if (!existsSync(paths.dir)) {
    const { mkdirSync } = await import("node:fs");
    mkdirSync(paths.dir, { recursive: true });
  }
  if (safeToWrite(paths.config) && !existsSync(paths.config)) {
    writeFileSync(
      paths.config,
      JSON.stringify(DEFAULT_TEAM_CONFIG, null, 2) + "\n"
    );
    console.log("  \u2713 Created .wisegit/ shared directory + config.json");
  } else if (existsSync(paths.config)) {
    console.log("  \u2713 .wisegit/ directory already exists");
  }

  // Create .mcp.json for Claude Code
  const mcpConfigPath = resolve(repoPath, ".mcp.json");
  const mcpConfig = {
    wisegit: {
      command: "npx",
      args: ["@sandip124/wisegit", "serve"],
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

  // Write Claude Code PreToolUse hooks
  const hookResult = writeClaudeHooks(repoPath);
  if (hookResult.hookCreated) {
    console.log("  \u2713 Created .claude/hooks/wisegit-check.sh");
  } else if (hookResult.hookSkipped) {
    console.log("  \u2713 .claude/hooks/wisegit-check.sh already exists — skipped");
  }
  if (hookResult.settingsUpdated) {
    console.log("  \u2713 Updated .claude/settings.json (PreToolUse hook registered)");
  } else if (hookResult.settingsSkipped) {
    console.log("  \u2713 .claude/settings.json merged (PreToolUse hook already registered)");
  }

  // Add .mcp.json to .gitignore (local paths — not shared)
  // Note: .wisegit/ is NOT gitignored — it's shared team knowledge
  const gitignorePath = resolve(repoPath, ".gitignore");
  if (safeToWrite(gitignorePath) && existsSync(gitignorePath)) {
    let gitignore = readFileSync(gitignorePath, "utf-8");
    let modified = false;
    if (!gitignore.includes(".mcp.json")) {
      gitignore = gitignore.trimEnd() + "\n.mcp.json\n";
      modified = true;
    }
    if (modified) {
      writeFileSync(gitignorePath, gitignore);
      console.log("  \u2713 Updated .gitignore");
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

      // Run full signal recompute so freeze scores include PageRank, co-change,
      // code structure, test signals, Naur theory, and obsolescence from day one.
      // Without this, scores are git-signals only — FROZEN functions may appear STABLE.
      console.log("  Computing full freeze scores (PageRank, co-change, test signals)...");
      try {
        const recomputed = await runRecomputePipeline(repoPath, db);
        console.log(
          `  \u2713 Scores ready: ${recomputed.functionsRecomputed} functions scored, ${recomputed.theoryGapsFound} theory gaps, ${recomputed.obsolescenceDetected} obsolete`
        );
      } catch (err) {
        console.log(
          "  \u26a0 Full scoring failed (partial scores available): " +
            (err instanceof Error ? err.message : String(err))
        );
      }
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
        ["mcp", "add", "wisegit", "--", "npx", "@sandip124/wisegit", "serve"],
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
  console.log("  3. Block edits to FROZEN functions (via PreToolUse hook)");
  console.log("  4. Call get_file_decisions before editing files");
  console.log(
    "\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501"
  );

  closeDb();
}
