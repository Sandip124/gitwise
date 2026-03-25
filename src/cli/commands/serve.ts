import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "../../mcp/server.js";
import { getDb } from "../../db/database.js";
import { runMigrations } from "../../db/migrator.js";
import { logger } from "../../shared/logger.js";

export async function serveCommand(): Promise<void> {
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
