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
import { overrideCommand } from "./commands/override.js";
import { branchCaptureCommand, branchListCommand, branchRecoverCommand } from "./commands/branch.js";
import { syncCommand } from "./commands/sync.js";
import { configCommand } from "./commands/config.js";
import { teamStatusCommand, teamTheoryHealthCommand } from "./commands/team.js";
import { reportCommand } from "./commands/report.js";

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

program
  .command("override <function>")
  .description("Override a frozen function with mandatory reason")
  .requiredOption("--reason <reason>", "Why the override is necessary (mandatory)")
  .option("--file <file>", "File containing the function")
  .option("--path <path>", "Path to the git repository")
  .option("--expires <duration>", "Auto-expire after duration (e.g., 7d, 24h)")
  .option("--list", "List all active overrides")
  .option("--revoke <function>", "Revoke an existing override")
  .action(async (target: string, opts) => {
    await overrideCommand(target, {
      reason: opts.reason,
      file: opts.file,
      path: opts.path,
      expires: opts.expires,
      list: opts.list,
      revoke: opts.revoke,
    });
  });

program
  .command("overrides")
  .description("List all active overrides")
  .option("--path <path>", "Path to the git repository")
  .action(async (opts) => {
    await overrideCommand("", { list: true, path: opts.path });
  });

program
  .command("branch-capture")
  .description("Capture branch context from the most recent merge commit")
  .option("--path <path>", "Path to the git repository")
  .action(async (opts) => {
    await branchCaptureCommand({ path: opts.path });
  });

program
  .command("branch-list")
  .description("List all captured branch snapshots")
  .option("--path <path>", "Path to the git repository")
  .action(async (opts) => {
    await branchListCommand({ path: opts.path });
  });

program
  .command("branch-recover <sha>")
  .description("Recover branch context from an existing merge commit SHA")
  .option("--path <path>", "Path to the git repository")
  .action(async (sha: string, opts) => {
    await branchRecoverCommand(sha, { path: opts.path });
  });

program
  .command("sync")
  .description(
    "Rebuild local cache from git history + .wisegit/ shared files (run after git pull)"
  )
  .option("--path <path>", "Path to the git repository")
  .action(async (opts) => {
    await syncCommand({ path: opts.path });
  });

program
  .command("config <action> [args...]")
  .description("View or modify team config (.wisegit/config.json)")
  .option("--path <path>", "Path to the git repository")
  .action(async (action: string, args: string[], opts) => {
    await configCommand(action, args, { path: opts.path });
  });

program
  .command("report")
  .description(
    "Generate an HTML report with freeze scores, theory health, timeline, and dependency insights"
  )
  .option("--path <path>", "Path to the git repository")
  .option("--output <file>", "Output file path (default: wisegit-report.html in repo root)")
  .action(async (opts) => {
    await reportCommand({ path: opts.path, output: opts.output });
  });

program
  .command("team-status")
  .description("Team overview: enrichment coverage, overrides, contributors")
  .option("--path <path>", "Path to the git repository")
  .action(async (opts) => {
    await teamStatusCommand({ path: opts.path });
  });

program
  .command("team-health")
  .description("Theory health: which functions have no active theory holders")
  .option("--path <path>", "Path to the git repository")
  .action(async (opts) => {
    await teamTheoryHealthCommand({ path: opts.path });
  });

program.parse();
