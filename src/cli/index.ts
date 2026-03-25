#!/usr/bin/env node

import { Command } from "commander";
import { initCommand } from "./commands/init.js";
import { auditCommand } from "./commands/audit.js";
import { historyCommand } from "./commands/history.js";
import { serveCommand } from "./commands/serve.js";
import { hookCommand } from "./commands/hook.js";

const program = new Command();

program
  .name("gitwise")
  .description(
    "Extract decision intent from git history and protect intentional code"
  )
  .version("0.1.0");

program
  .command("init")
  .description("Index git history and extract decision intent")
  .option("--full-history", "Re-index all commits (even if already indexed)")
  .option("--path <path>", "Path to the git repository")
  .action(async (opts) => {
    await initCommand({
      fullHistory: opts.fullHistory,
      path: opts.path,
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

program.parse();
