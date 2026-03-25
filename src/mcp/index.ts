import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "./server.js";
import { getDb } from "../db/database.js";
import { runMigrations } from "../db/migrator.js";
import { logger } from "../shared/logger.js";

/**
 * MCP server entry point — stdio transport.
 *
 * Critical: all logging goes to stderr. stdout is reserved for
 * the MCP JSON-RPC protocol.
 */
async function main(): Promise<void> {
  const db = getDb();

  try {
    runMigrations(db);
  } catch (err) {
    logger.error("Failed to run migrations", err);
  }

  const server = createMcpServer(db);
  const transport = new StdioServerTransport();
  await server.connect(transport);

  logger.info("gitwise MCP server started on stdio");
}

main().catch((err) => {
  logger.error("Fatal error starting MCP server", err);
  process.exit(1);
});
