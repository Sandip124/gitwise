#!/usr/bin/env node

import { Command } from "commander";
import { initCommand } from "./commands/init.js";
import { auditCommand } from "./commands/audit.js";
import { historyCommand } from "./commands/history.js";
import { serveCommand } from "./commands/serve.js";
import { hookCommand } from "./commands/hook.js";
import { setupCommand } from "./commands/setup.js";
import { enrichCommand } from "./commands/enrich.js";
import { recomputeCommand } from "./commands/recompute.js";

const program = new Command();

program
  .name("wisegit")
  .description(
    "Extract decision intent from git history and protect intentional code"
  )
  .version("0.1.0");

program
  .command("init")
  .description("Index git history and extract decision intent")
  .option("--full-history", "Re-index all commits (even if already indexed)")
  .option("--path <path>", "Path to the git repository")
  .option("--ollama", "Use Ollama for NOISE commit intent extraction (requires local Ollama)")
  .action(async (opts) => {
    await initCommand({
      fullHistory: opts.fullHistory,
      path: opts.path,
      ollama: opts.ollama,
    });
  });

program
  .command("audit <file>")
  .description("Show decision manifest for a file")
  .option("--path <path>", "Path to the git repository")
  .action(async (file: string, opts) => {
    await auditCommand(file, { path: opts.path });
  });

program
  .command("history <target>")
  .description("Show decision timeline for a file or function")
  .option("--file <file>", "File containing the function (for function lookup)")
  .option("--path <path>", "Path to the git repository")
  .action(async (target: string, opts) => {
    await historyCommand(target, {
      path: opts.path,
      file: opts.file,
    });
  });

program
  .command("serve")
  .description("Start the gitwise MCP server (stdio transport)")
  .action(async () => {
    await serveCommand();
  });

program
  .command("hook <action>")
  .description("Install or uninstall git hooks (install|uninstall)")
  .option("--path <path>", "Path to the git repository")
  .action(async (action: string, opts) => {
    await hookCommand(action, { path: opts.path });
  });

program
  .command("setup")
  .description(
    "One-command setup: configure MCP, CLAUDE.md rules, and index a repo"
  )
  .option("--path <path>", "Path to the git repository to set up")
  .option("--skip-index", "Skip indexing (just configure MCP + CLAUDE.md)")
  .option("--global", "Also register gitwise globally with Claude Code CLI")
  .action(async (opts) => {
    await setupCommand({
      path: opts.path,
      skipIndex: opts.skipIndex,
      global: opts.global,
    });
  });

program
  .command("enrich")
  .description(
    "Fetch issue/PR context from GitHub/GitLab and enrich decision events"
  )
  .option("--path <path>", "Path to the git repository")
  .action(async (opts) => {
    await enrichCommand({ path: opts.path });
  });

program
  .command("recompute")
  .description(
    "Recompute freeze scores with full signals (PageRank, theory gaps, co-change)"
  )
  .option("--path <path>", "Path to the git repository")
  .action(async (opts) => {
    await recomputeCommand({ path: opts.path });
  });

program.parse();
