import { Ollama } from "ollama";
import { loadConfig } from "../shared/config.js";
import { logger } from "../shared/logger.js";

/**
 * Generate embeddings using Ollama's nomic-embed-text model.
 * Used for semantic search in search_decisions (Phase 2+).
 */
export async function generateEmbedding(text: string): Promise<number[] | null> {
  const config = loadConfig();

  try {
    const ollama = new Ollama({ host: config.ollamaUrl });
    const response = await ollama.embed({
      model: config.ollamaEmbedModel,
      input: text,
    });

    return response.embeddings[0] ?? null;
  } catch (err) {
    logger.warn(
      `Embedding generation failed: ${err instanceof Error ? err.message : String(err)}`
    );
    return null;
  }
}
