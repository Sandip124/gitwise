import { Ollama } from "ollama";
import { loadConfig } from "../shared/config.js";
import { logger } from "../shared/logger.js";

let ollamaInstance: Ollama | null = null;

function getOllama(): Ollama {
  if (!ollamaInstance) {
    const config = loadConfig();
    ollamaInstance = new Ollama({ host: config.ollamaUrl });
  }
  return ollamaInstance;
}

/**
 * Check if Ollama is available and the required model is installed.
 */
export async function isOllamaAvailable(): Promise<boolean> {
  try {
    const ollama = getOllama();
    await ollama.list();
    return true;
  } catch {
    return false;
  }
}

/**
 * Extract intent from a diff using Ollama (for NOISE commits).
 *
 * Per Hericko et al. [4]: commit messages alone are insufficient.
 * For NOISE commits where the message carries no signal, we extract
 * intent from the diff shape itself.
 */
export async function extractIntentWithLlm(
  diff: string,
  surroundingContext: string
): Promise<string | null> {
  const config = loadConfig();

  try {
    const ollama = getOllama();
    const response = await ollama.chat({
      model: config.ollamaChatModel,
      messages: [
        {
          role: "system",
          content: `You are a code historian. Given a git diff and surrounding code context,
extract a 1-2 sentence summary of the INTENT behind the change — why it was made,
not what was changed. Focus on the decision rationale. Be concise and specific.
If the intent is unclear, say so honestly.`,
        },
        {
          role: "user",
          content: `Diff:\n\`\`\`\n${diff.slice(0, 2000)}\n\`\`\`\n\nContext:\n\`\`\`\n${surroundingContext.slice(0, 1000)}\n\`\`\`\n\nWhat was the intent behind this change?`,
        },
      ],
      options: {
        temperature: 0.3, // Low temperature for factual extraction
        num_predict: 150, // Short response
      },
    });

    return response.message.content.trim() || null;
  } catch (err) {
    logger.warn(
      `Ollama intent extraction failed: ${err instanceof Error ? err.message : String(err)}`
    );
    return null;
  }
}
