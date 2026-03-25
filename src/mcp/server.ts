import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import pg from "pg";
import { getFileDecisions } from "./tools/get-file-decisions.js";
import { getFreezeScoreForFunction } from "./tools/get-freeze-score.js";
import { searchDecisions } from "./tools/search-decisions.js";
import { logger } from "../shared/logger.js";

/**
 * Create and configure the gitwise MCP server.
 *
 * MCP tools:
 * - get_file_decisions: manifest + freeze scores for a file
 * - get_freeze_score: score + signal breakdown for a function
 * - search_decisions: keyword search across all decisions
 */
export function createMcpServer(pool: pg.Pool): McpServer {
  const server = new McpServer({
    name: "gitwise",
    version: "0.1.0",
  });

  // ── get_file_decisions ──
  server.tool(
    "get_file_decisions",
    "Get the decision manifest for a file — shows freeze scores, intent history, and recovery levels for all tracked functions. Call this BEFORE editing any file.",
    {
      filePath: z.string().describe("Path to the file (relative to repo root)"),
      repoPath: z
        .string()
        .optional()
        .describe("Absolute path to the git repository root"),
    },
    async ({ filePath, repoPath }) => {
      try {
        const result = await getFileDecisions(pool, filePath, repoPath);
        return {
          content: [{ type: "text" as const, text: result.manifest }],
        };
      } catch (err) {
        logger.error("get_file_decisions failed", err);
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // ── get_freeze_score ──
  server.tool(
    "get_freeze_score",
    "Get the freeze score and signal breakdown for a specific function. Shows why a function is frozen/stable/open.",
    {
      filePath: z.string().describe("Path to the file containing the function"),
      functionName: z.string().describe("Name of the function"),
      repoPath: z
        .string()
        .optional()
        .describe("Absolute path to the git repository root"),
    },
    async ({ filePath, functionName, repoPath }) => {
      try {
        const result = await getFreezeScoreForFunction(
          pool,
          filePath,
          functionName,
          repoPath
        );
        return {
          content: [{ type: "text" as const, text: result.formatted }],
        };
      } catch (err) {
        logger.error("get_freeze_score failed", err);
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // ── search_decisions ──
  server.tool(
    "search_decisions",
    "Search past decisions by keyword. Finds intent history across the entire repository.",
    {
      query: z.string().describe("Search query (keyword or phrase)"),
      repoPath: z
        .string()
        .optional()
        .describe("Absolute path to the git repository root"),
      limit: z
        .number()
        .optional()
        .default(10)
        .describe("Maximum results to return"),
    },
    async ({ query, repoPath, limit }) => {
      try {
        const results = await searchDecisions(pool, query, repoPath, limit);

        if (results.length === 0) {
          return {
            content: [
              { type: "text" as const, text: `No decisions found for "${query}".` },
            ],
          };
        }

        const formatted = results
          .map(
            (r) =>
              `${r.filePath}::${r.functionName}() [${r.confidence}]\n  ${r.intent}\n  — ${r.author} (${r.commitSha})`
          )
          .join("\n\n");

        return {
          content: [{ type: "text" as const, text: formatted }],
        };
      } catch (err) {
        logger.error("search_decisions failed", err);
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  return server;
}
