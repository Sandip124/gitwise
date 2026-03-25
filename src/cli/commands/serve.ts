import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "../../mcp/server.js";
import { getPool } from "../../db/pool.js";
import { runMigrations } from "../../db/migrator.js";
import { logger } from "../../shared/logger.js";

export async function serveCommand(): Promise<void> {
  const pool = getPool();

  try {
    await runMigrations(pool);
  } catch (err) {
    logger.error("Failed to run migrations", err);
  }

  const server = createMcpServer(pool);
  const transport = new StdioServerTransport();
  await server.connect(transport);

  logger.info("gitwise MCP server started on stdio");
}
