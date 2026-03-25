import { FileDiff, DiffHunk, DiffLine } from "../core/types.js";

/**
 * Parse unified diff output into structured FileDiff objects.
 * Custom parser — unified diff format is well-specified.
 */
export function parseDiff(diffText: string): FileDiff[] {
  const files: FileDiff[] = [];
  const lines = diffText.split("\n");
  let i = 0;

  while (i < lines.length) {
    // Find diff header: "diff --git a/... b/..."
    if (!lines[i].startsWith("diff --git ")) {
      i++;
      continue;
    }

    const fileDiff = parseFileDiff(lines, i);
    if (fileDiff) {
      files.push(fileDiff.diff);
      i = fileDiff.nextIndex;
    } else {
      i++;
    }
  }

  return files;
}

interface ParsedFileDiff {
  diff: FileDiff;
  nextIndex: number;
}

function parseFileDiff(
  lines: string[],
  startIndex: number
): ParsedFileDiff | null {
  let i = startIndex;

  // Parse "diff --git a/path b/path"
  const diffLine = lines[i];
  const pathMatch = diffLine.match(/^diff --git a\/(.+?) b\/(.+)$/);
  if (!pathMatch) return null;

  let oldPath = pathMatch[1];
  let newPath = pathMatch[2];
  let isNew = false;
  let isDeleted = false;
  let isRenamed = false;
  i++;

  // Parse header lines until we hit --- or the next diff
  while (i < lines.length && !lines[i].startsWith("diff --git ")) {
    const line = lines[i];

    if (line.startsWith("new file mode")) {
      isNew = true;
    } else if (line.startsWith("deleted file mode")) {
      isDeleted = true;
    } else if (line.startsWith("rename from ")) {
      isRenamed = true;
      oldPath = line.slice("rename from ".length);
    } else if (line.startsWith("rename to ")) {
      isRenamed = true;
      newPath = line.slice("rename to ".length);
    } else if (line.startsWith("--- ")) {
      break;
    } else if (line.startsWith("Binary files")) {
      // Binary file — skip
      return {
        diff: {
          oldPath,
          newPath,
          hunks: [],
          isNew,
          isDeleted,
          isRenamed,
        },
        nextIndex: i + 1,
      };
    }

    i++;
  }

  // Parse --- and +++ lines
  if (i < lines.length && lines[i].startsWith("--- ")) {
    i++;
  }
  if (i < lines.length && lines[i].startsWith("+++ ")) {
    i++;
  }

  // Parse hunks
  const hunks: DiffHunk[] = [];
  while (i < lines.length && !lines[i].startsWith("diff --git ")) {
    if (lines[i].startsWith("@@")) {
      const hunkResult = parseHunk(lines, i);
      if (hunkResult) {
        hunks.push(hunkResult.hunk);
        i = hunkResult.nextIndex;
      } else {
        i++;
      }
    } else {
      i++;
    }
  }

  return {
    diff: { oldPath, newPath, hunks, isNew, isDeleted, isRenamed },
    nextIndex: i,
  };
}

interface ParsedHunk {
  hunk: DiffHunk;
  nextIndex: number;
}

function parseHunk(lines: string[], startIndex: number): ParsedHunk | null {
  const headerMatch = lines[startIndex].match(
    /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/
  );
  if (!headerMatch) return null;

  const oldStart = parseInt(headerMatch[1], 10);
  const oldCount = headerMatch[2] !== undefined ? parseInt(headerMatch[2], 10) : 1;
  const newStart = parseInt(headerMatch[3], 10);
  const newCount = headerMatch[4] !== undefined ? parseInt(headerMatch[4], 10) : 1;

  const hunkLines: DiffLine[] = [];
  let i = startIndex + 1;
  let oldLine = oldStart;
  let newLine = newStart;

  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith("@@") || line.startsWith("diff --git ")) {
      break;
    }

    if (line.startsWith("+")) {
      hunkLines.push({
        type: "add",
        content: line.slice(1),
        oldLineNumber: null,
        newLineNumber: newLine++,
      });
    } else if (line.startsWith("-")) {
      hunkLines.push({
        type: "remove",
        content: line.slice(1),
        oldLineNumber: oldLine++,
        newLineNumber: null,
      });
    } else if (line.startsWith(" ") || line === "") {
      hunkLines.push({
        type: "context",
        content: line.startsWith(" ") ? line.slice(1) : line,
        oldLineNumber: oldLine++,
        newLineNumber: newLine++,
      });
    } else if (line.startsWith("\\")) {
      // "\ No newline at end of file" — skip
    } else {
      break;
    }

    i++;
  }

  return {
    hunk: { oldStart, oldCount, newStart, newCount, lines: hunkLines },
    nextIndex: i,
  };
}
