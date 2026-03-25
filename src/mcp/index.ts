import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "./server.js";
import { getPool } from "../db/pool.js";
import { runMigrations } from "../db/migrator.js";
import { logger } from "../shared/logger.js";

/**
 * MCP server entry point — stdio transport.
 *
 * Critical: all logging goes to stderr. stdout is reserved for
 * the MCP JSON-RPC protocol.
 */
async function main(): Promise<void> {
  const pool = getPool();

  // Ensure DB schema is ready
  try {
    await runMigrations(pool);
  } catch (err) {
    logger.error("Failed to run migrations", err);
    // Continue anyway — migrations may have already been applied
  }

  const server = createMcpServer(pool);
  const transport = new StdioServerTransport();
  await server.connect(transport);

  logger.info("gitwise MCP server started on stdio");
}

main().catch((err) => {
  logger.error("Fatal error starting MCP server", err);
  process.exit(1);
});
