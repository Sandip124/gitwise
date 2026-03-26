import { resolve } from "node:path";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import {
  getWisegitPaths,
  TeamConfig,
  DEFAULT_TEAM_CONFIG,
} from "../../shared/team-types.js";

/**
 * Read the team config, falling back to defaults.
 */
function loadTeamConfig(repoPath: string): TeamConfig {
  const paths = getWisegitPaths(repoPath);
  if (!existsSync(paths.config)) {
    return { ...DEFAULT_TEAM_CONFIG };
  }
  try {
    const raw = JSON.parse(readFileSync(paths.config, "utf-8"));
    return { ...DEFAULT_TEAM_CONFIG, ...raw };
  } catch {
    return { ...DEFAULT_TEAM_CONFIG };
  }
}

export async function configCommand(
  action: string,
  args: string[],
  options: { path?: string }
): Promise<void> {
  const repoPath = resolve(options.path ?? process.cwd());
  const paths = getWisegitPaths(repoPath);

  if (action === "list" || action === "show") {
    const config = loadTeamConfig(repoPath);
    console.log("Team configuration (.wisegit/config.json):\n");
    console.log(JSON.stringify(config, null, 2));
    return;
  }

  if (action === "set") {
    if (args.length < 2) {
      console.error("Usage: wisegit config set <key> <value>");
      console.error("Example: wisegit config set override_requires_approval true");
      process.exit(1);
    }

    const [key, ...valueParts] = args;
    const valueStr = valueParts.join(" ");
    const config = loadTeamConfig(repoPath);

    // Parse value
    let value: unknown;
    if (valueStr === "true") value = true;
    else if (valueStr === "false") value = false;
    else if (/^\d+$/.test(valueStr)) value = parseInt(valueStr, 10);
    else if (/^\d+\.\d+$/.test(valueStr)) value = parseFloat(valueStr);
    else if (valueStr.startsWith("[")) {
      try {
        value = JSON.parse(valueStr);
      } catch {
        value = valueStr;
      }
    } else {
      value = valueStr;
    }

    // Handle nested keys like freeze_thresholds.frozen
    const parts = key.split(".");
    if (parts.length === 2) {
      const [parent, child] = parts;
      const parentObj = (config as unknown as Record<string, unknown>)[parent];
      if (typeof parentObj === "object" && parentObj !== null) {
        (parentObj as Record<string, unknown>)[child] = value;
      } else {
        console.error(`Error: ${parent} is not a nested config object.`);
        process.exit(1);
      }
    } else if (parts.length === 1) {
      if (!(key in config)) {
        console.error(`Error: Unknown config key "${key}".`);
        console.error(
          `Valid keys: ${Object.keys(DEFAULT_TEAM_CONFIG).join(", ")}`
        );
        process.exit(1);
      }
      (config as unknown as Record<string, unknown>)[key] = value;
    } else {
      console.error("Error: Only one level of nesting supported (e.g., freeze_thresholds.frozen)");
      process.exit(1);
    }

    writeFileSync(paths.config, JSON.stringify(config, null, 2) + "\n");
    console.log(`Set ${key} = ${JSON.stringify(value)}`);
    return;
  }

  console.error(`Unknown config action: ${action}. Use "list" or "set".`);
  process.exit(1);
}
