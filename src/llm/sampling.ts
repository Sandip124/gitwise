import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { logger } from "../shared/logger.js";

/**
 * Extract intent from a diff using MCP sampling — asks the HOST LLM
 * (Claude Code) to analyze the diff instead of running a separate Ollama.
 *
 * This is the preferred path when running inside an MCP-connected client.
 * The host LLM is already present — no need for a second LLM.
 */
export async function extractIntentViaSampling(
  server: Server,
  diff: string,
  commitMessage: string
): Promise<string | null> {
  try {
    const result = await server.createMessage({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `You are a code historian. Given this git diff and commit message, extract a 1-2 sentence summary of the INTENT behind the change — why it was made, not what was changed. Focus on the decision rationale. Be concise.

Commit message: "${commitMessage}"

Diff (truncated):
\`\`\`
${diff.slice(0, 2000)}
\`\`\`

Intent:`,
          },
        },
      ],
      maxTokens: 150,
    });

    if (result.content.type === "text" && result.content.text) {
      return result.content.text.trim();
    }

    return null;
  } catch (err) {
    logger.debug(
      `MCP sampling not available: ${err instanceof Error ? err.message : String(err)}`
    );
    return null;
  }
}

/**
 * Check if the connected MCP client supports sampling.
 */
export function isSamplingAvailable(server: Server): boolean {
  try {
    // The server tracks client capabilities after connection
    const caps = (server as unknown as { _clientCapabilities?: { sampling?: unknown } })
      ._clientCapabilities;
    return !!caps?.sampling;
  } catch {
    return false;
  }
}
