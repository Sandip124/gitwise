import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import Database from "better-sqlite3";
import { getFileDecisions } from "./tools/get-file-decisions.js";
import { getFreezeScoreForFunction } from "./tools/get-freeze-score.js";
import { searchDecisions } from "./tools/search-decisions.js";
import { createOverrideFromMcp } from "./tools/create-override.js";
import { getFunctionHistory } from "./tools/get-function-history.js";
import { getTheoryGaps } from "./tools/get-theory-gaps.js";
import { getBranchContext } from "./tools/get-branch-context.js";
import { extractIntentForFunction } from "./tools/extract-intent.js";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { syncSharedLayer } from "../pipeline/sync-pipeline.js";
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
  /**
   * Auto-sync .wisegit/ shared files before serving data.
   * Fast no-op (< 1ms) when nothing changed. Only syncs when
   * JSONL files are newer than last sync.
   */
  function autoSync(repoPath?: string): void {
    if (repoPath) {
      try {
        syncSharedLayer(db, repoPath);
      } catch {
        // Sync failure should never block tool calls
      }
    }
  }

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
        autoSync(repoPath);
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
        autoSync(repoPath);
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
        autoSync(repoPath);
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

  // ── get_function_history ──
  server.tool(
    "get_function_history",
    "Get the full chronological decision timeline for a specific function. Shows every event: creation, changes, overrides, issue enrichments.",
    {
      filePath: safeFilePath.describe("Path to the file containing the function"),
      functionName: safeFunctionName.describe("Name of the function"),
      repoPath: safeRepoPath.describe("Absolute path to the git repository root"),
    },
    async ({ filePath, functionName, repoPath }) => {
      try {
        const result = getFunctionHistory(db, filePath, functionName, repoPath);
        return { content: [{ type: "text" as const, text: result }] };
      } catch (err) {
        logger.error("get_function_history failed", err);
        return {
          content: [{ type: "text" as const, text: sanitizeError(err) }],
          isError: true,
        };
      }
    }
  );

  // ── get_theory_gaps ──
  server.tool(
    "get_theory_gaps",
    "Get functions in a file where the original decision rationale may be unrecoverable (primary author inactive, timeline gaps). These need extra caution.",
    {
      filePath: safeFilePath.describe("Path to the file to check"),
      repoPath: safeRepoPath.describe("Absolute path to the git repository root"),
    },
    async ({ filePath, repoPath }) => {
      try {
        const result = getTheoryGaps(db, filePath, repoPath);
        return { content: [{ type: "text" as const, text: result }] };
      } catch (err) {
        logger.error("get_theory_gaps failed", err);
        return {
          content: [{ type: "text" as const, text: sanitizeError(err) }],
          isError: true,
        };
      }
    }
  );

  // ── get_branch_context ──
  server.tool(
    "get_branch_context",
    "Get branch merge history — what branches were merged and what they changed. Useful for understanding migrations and cross-platform decisions.",
    {
      repoPath: safeRepoPath.describe("Absolute path to the git repository root"),
      filePath: safeFilePath
        .optional()
        .describe("Filter to branches that modified this file"),
    },
    async ({ repoPath, filePath }) => {
      try {
        const result = getBranchContext(db, repoPath, filePath);
        return { content: [{ type: "text" as const, text: result }] };
      } catch (err) {
        logger.error("get_branch_context failed", err);
        return {
          content: [{ type: "text" as const, text: sanitizeError(err) }],
          isError: true,
        };
      }
    }
  );

  // ── extract_intent ──
  server.tool(
    "extract_intent",
    "Extract decision intent for a function's NOISE commits using the host LLM (no Ollama needed). Call this when a function has events with LOW or missing intent to recover the 'why' behind changes.",
    {
      filePath: safeFilePath.describe("Path to the file containing the function"),
      functionName: safeFunctionName.describe("Name of the function"),
      repoPath: safeRepoPath.describe("Absolute path to the git repository root"),
    },
    async ({ filePath, functionName, repoPath }) => {
      try {
        const result = await extractIntentForFunction(
          server.server,
          db,
          filePath,
          functionName,
          repoPath
        );
        return { content: [{ type: "text" as const, text: result }] };
      } catch (err) {
        logger.error("extract_intent failed", err);
        return {
          content: [{ type: "text" as const, text: sanitizeError(err) }],
          isError: true,
        };
      }
    }
  );

  // ── Resource template: decision manifests ──
  // Exposes file manifests as MCP resources — auto-discoverable by clients
  server.resource(
    "file-manifest",
    new ResourceTemplate("wisegit://manifest/{+filePath}", {
      list: undefined,
      complete: {
        filePath: () => [], // No autocomplete for now
      },
    }),
    { mimeType: "text/plain", description: "Decision manifest for a source file" },
    (uri, variables) => {
      const filePath = variables.filePath as string;
      if (!filePath || filePath.includes("..") || filePath.includes("\0")) {
        return { contents: [{ uri: uri.toString(), text: "Invalid file path." }] };
      }
      const result = getFileDecisions(db, filePath);
      return { contents: [{ uri: uri.toString(), text: result.manifest }] };
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
