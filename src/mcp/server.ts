import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import Database from "better-sqlite3";
import { getFileDecisions } from "./tools/get-file-decisions.js";
import { getFreezeScoreForFunction } from "./tools/get-freeze-score.js";
import { searchDecisions } from "./tools/search-decisions.js";
import { createOverrideFromMcp } from "./tools/create-override.js";
import { logger } from "../shared/logger.js";
import { GitwiseError } from "../shared/errors.js";

// ── Input validation schemas ──

const safeFilePath = z
  .string()
  .min(1)
  .max(500)
  .refine((s) => !s.includes("\0"), "Null bytes not allowed")
  .refine((s) => !s.includes(".."), "Path traversal not allowed");

const safeRepoPath = z
  .string()
  .min(1)
  .max(500)
  .refine((s) => !s.includes("\0"), "Null bytes not allowed")
  .optional();

const safeFunctionName = z.string().min(1).max(200);

const safeQuery = z.string().min(1).max(500);

const safeLimit = z.number().int().min(1).max(100).optional().default(10);

/**
 * Sanitize error for MCP client responses.
 * Only expose messages from GitwiseError (our own errors).
 * All other errors get a generic message — details logged to stderr.
 */
function sanitizeError(err: unknown): string {
  if (err instanceof GitwiseError) {
    return err.message;
  }
  return "An internal error occurred. Check gitwise server logs for details.";
}

/**
 * Create and configure the gitwise MCP server.
 *
 * MCP tools:
 * - get_file_decisions: manifest + freeze scores for a file
 * - get_freeze_score: score + signal breakdown for a function
 * - search_decisions: keyword search across all decisions
 */
export function createMcpServer(db: Database.Database): McpServer {
  const server = new McpServer({
    name: "wisegit",
    version: "0.1.0",
  });

  // ── get_file_decisions ──
  server.tool(
    "get_file_decisions",
    "Get the decision manifest for a file — shows freeze scores, intent history, and recovery levels for all tracked functions. Call this BEFORE editing any file.",
    {
      filePath: safeFilePath.describe("Path to the file (relative to repo root)"),
      repoPath: safeRepoPath.describe(
        "Absolute path to the git repository root"
      ),
    },
    async ({ filePath, repoPath }) => {
      try {
        const result = getFileDecisions(db, filePath, repoPath);
        return {
          content: [{ type: "text" as const, text: result.manifest }],
        };
      } catch (err) {
        logger.error("get_file_decisions failed", err);
        return {
          content: [
            { type: "text" as const, text: sanitizeError(err) },
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
      filePath: safeFilePath.describe(
        "Path to the file containing the function"
      ),
      functionName: safeFunctionName.describe("Name of the function"),
      repoPath: safeRepoPath.describe(
        "Absolute path to the git repository root"
      ),
    },
    async ({ filePath, functionName, repoPath }) => {
      try {
        const result = getFreezeScoreForFunction(
          db,
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
            { type: "text" as const, text: sanitizeError(err) },
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
      query: safeQuery.describe("Search query (keyword or phrase)"),
      repoPath: safeRepoPath.describe(
        "Absolute path to the git repository root"
      ),
      limit: safeLimit.describe("Maximum results to return (1–100)"),
    },
    async ({ query, repoPath, limit }) => {
      try {
        const results = searchDecisions(db, query, repoPath, limit);

        if (results.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: `No decisions found for "${query}".`,
              },
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
            { type: "text" as const, text: sanitizeError(err) },
          ],
          isError: true,
        };
      }
    }
  );

  // ── create_override ──
  server.tool(
    "create_override",
    "Request an override for a FROZEN or STABLE function so it can be modified. The user MUST approve this action. Provide a clear reason why the override is needed. The override is recorded in the audit trail permanently.",
    {
      filePath: safeFilePath.describe("Path to the file containing the function"),
      functionName: safeFunctionName.describe("Name of the function to override"),
      reason: z
        .string()
        .min(10, "Reason must be at least 10 characters — explain why the override is needed")
        .max(500)
        .describe("Why this override is necessary (mandatory, min 10 chars)"),
      expires: z
        .string()
        .regex(/^\d+(d|h|m)$/, "Duration format: 7d, 24h, 30m")
        .optional()
        .describe("Auto-expire after duration (e.g., 7d, 24h). Omit for permanent."),
    },
    async ({ filePath, functionName, reason, expires }) => {
      try {
        const result = createOverrideFromMcp(db, filePath, functionName, reason, expires);
        return {
          content: [{ type: "text" as const, text: result }],
        };
      } catch (err) {
        logger.error("create_override failed", err);
        return {
          content: [{ type: "text" as const, text: sanitizeError(err) }],
          isError: true,
        };
      }
    }
  );

  // ── Prompt: decision protection workflow ──
  server.prompt(
    "check_before_edit",
    "MANDATORY workflow before editing any file. Returns the decision manifest showing which functions are FROZEN, STABLE, or OPEN.",
    {
      filePath: safeFilePath.describe("File path about to be edited"),
    },
    ({ filePath }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: [
              `Before editing ${filePath}, check its decision manifest.`,
              "",
              "Rules:",
              "- FROZEN (score ≥ 0.80): DO NOT modify without explicit user approval.",
              "  These contain verified, intentional decisions backed by git history.",
              "- STABLE (score 0.50–0.79): Proceed with caution. Review intent history",
              "  and explain why the change is safe before proceeding.",
              "- OPEN (score < 0.50): Safe to modify freely.",
              "- THEORY GAP: Treat all logic as intentional pending manual review.",
              "",
              `Call get_file_decisions with filePath="${filePath}" now.`,
            ].join("\n"),
          },
        },
      ],
    })
  );

  return server;
}
