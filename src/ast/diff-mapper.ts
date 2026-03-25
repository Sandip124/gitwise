import { FunctionChunk, DiffHunk } from "../core/types.js";

export interface AffectedFunction {
  chunk: FunctionChunk;
  changeType: "modified" | "created" | "deleted";
}

/**
 * Map diff hunks to affected function chunks by line range overlap.
 *
 * This is the critical bridge between git diffs and function-level events.
 * Per Giger et al. [6]: knowing which AST node was affected matters more
 * than raw line count for bug prediction.
 */
export function mapDiffToFunctions(
  hunks: DiffHunk[],
  chunks: FunctionChunk[],
  isNewFile: boolean,
  isDeletedFile: boolean
): AffectedFunction[] {
  if (chunks.length === 0) return [];

  // New file: all functions are "created"
  if (isNewFile) {
    return chunks.map((chunk) => ({
      chunk,
      changeType: "created" as const,
    }));
  }

  // Deleted file: all functions are "deleted"
  if (isDeletedFile) {
    return chunks.map((chunk) => ({
      chunk,
      changeType: "deleted" as const,
    }));
  }

  // Map hunks to functions by line range overlap
  const affected = new Map<string, AffectedFunction>();

  for (const hunk of hunks) {
    const hunkStart = hunk.newStart;
    const hunkEnd = hunk.newStart + hunk.newCount - 1;

    for (const chunk of chunks) {
      if (affected.has(chunk.functionId)) continue;

      // Check if hunk overlaps with function boundaries
      if (rangesOverlap(hunkStart, hunkEnd, chunk.startLine, chunk.endLine)) {
        affected.set(chunk.functionId, {
          chunk,
          changeType: "modified",
        });
      }
    }
  }

  return [...affected.values()];
}

function rangesOverlap(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number
): boolean {
  return aStart <= bEnd && aEnd >= bStart;
}
