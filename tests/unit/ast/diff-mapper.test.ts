import { describe, it, expect } from "vitest";
import { mapDiffToFunctions } from "../../../src/ast/diff-mapper.js";
import { FunctionChunk, DiffHunk } from "../../../src/core/types.js";

function makeChunk(
  name: string,
  start: number,
  end: number
): FunctionChunk {
  return {
    filePath: "test.ts",
    functionName: name,
    functionId: `file:test.ts::function:${name}`,
    language: "typescript",
    startLine: start,
    endLine: end,
  };
}

function makeHunk(
  newStart: number,
  newCount: number
): DiffHunk {
  return {
    oldStart: newStart,
    oldCount: newCount,
    newStart,
    newCount,
    lines: [],
  };
}

describe("mapDiffToFunctions", () => {
  it("maps hunk to overlapping function", () => {
    const chunks = [makeChunk("foo", 5, 15), makeChunk("bar", 20, 30)];
    const hunks = [makeHunk(10, 3)]; // lines 10-12 — overlaps foo

    const result = mapDiffToFunctions(hunks, chunks, false, false);
    expect(result).toHaveLength(1);
    expect(result[0].chunk.functionName).toBe("foo");
    expect(result[0].changeType).toBe("modified");
  });

  it("maps hunk overlapping multiple functions", () => {
    const chunks = [makeChunk("foo", 5, 15), makeChunk("bar", 12, 25)];
    const hunks = [makeHunk(10, 8)]; // lines 10-17 — overlaps both

    const result = mapDiffToFunctions(hunks, chunks, false, false);
    expect(result).toHaveLength(2);
  });

  it("marks all functions as created for new files", () => {
    const chunks = [makeChunk("foo", 1, 10), makeChunk("bar", 12, 20)];
    const hunks = [makeHunk(1, 20)];

    const result = mapDiffToFunctions(hunks, chunks, true, false);
    expect(result).toHaveLength(2);
    expect(result.every((r) => r.changeType === "created")).toBe(true);
  });

  it("marks all functions as deleted for deleted files", () => {
    const chunks = [makeChunk("foo", 1, 10)];
    const hunks = [];

    const result = mapDiffToFunctions(hunks, chunks, false, true);
    expect(result).toHaveLength(1);
    expect(result[0].changeType).toBe("deleted");
  });

  it("returns empty for no overlapping functions", () => {
    const chunks = [makeChunk("foo", 5, 15)];
    const hunks = [makeHunk(20, 3)]; // lines 20-22 — no overlap

    const result = mapDiffToFunctions(hunks, chunks, false, false);
    expect(result).toHaveLength(0);
  });

  it("returns empty for no chunks", () => {
    const hunks = [makeHunk(1, 10)];
    const result = mapDiffToFunctions(hunks, [], false, false);
    expect(result).toHaveLength(0);
  });

  it("handles exact boundary overlap", () => {
    const chunks = [makeChunk("foo", 5, 10)];
    const hunks = [makeHunk(10, 1)]; // line 10 — exactly the last line of foo

    const result = mapDiffToFunctions(hunks, chunks, false, false);
    expect(result).toHaveLength(1);
    expect(result[0].chunk.functionName).toBe("foo");
  });
});
