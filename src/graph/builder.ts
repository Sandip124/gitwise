import Database from "better-sqlite3";
import type { Tree, Node } from "web-tree-sitter";
import { DirectedGraph } from "graphology";
import { initParser, parseSource } from "../ast/parser.js";
import { extractChunks } from "../ast/chunk-extractor.js";
import { getLanguageForFile, isSupportedFile } from "../ast/languages/index.js";
import { makeFunctionId } from "../core/types.js";
import { logger } from "../shared/logger.js";

/**
 * Build a call graph from the current state of source files.
 *
 * Per Kim et al. [8]: spatial locality — functions called frequently
 * from many places are more load-bearing and should be protected.
 * Per Ying et al. [5]: co-change dependencies revealed by graph structure.
 *
 * Nodes = functions (by functionId)
 * Edges = function A calls function B (directed)
 */
export async function buildCallGraph(
  repoPath: string,
  db: Database.Database
): Promise<DirectedGraph> {
  const graph = new DirectedGraph({ allowSelfLoops: false });

  // Get all tracked function chunks from DB
  const chunks = db
    .prepare(
      `SELECT function_id, file_path, function_name, language
       FROM function_chunks WHERE repo_path = ?`
    )
    .all(repoPath) as {
    function_id: string;
    file_path: string;
    function_name: string;
    language: string;
  }[];

  // Build a lookup of known function names → function IDs
  const nameToIds = new Map<string, string[]>();
  for (const chunk of chunks) {
    graph.addNode(chunk.function_id, {
      filePath: chunk.file_path,
      functionName: chunk.function_name,
    });

    const ids = nameToIds.get(chunk.function_name) ?? [];
    ids.push(chunk.function_id);
    nameToIds.set(chunk.function_name, ids);
  }

  // Group chunks by file
  const fileChunks = new Map<string, typeof chunks>();
  for (const chunk of chunks) {
    const existing = fileChunks.get(chunk.file_path) ?? [];
    existing.push(chunk);
    fileChunks.set(chunk.file_path, existing);
  }

  await initParser();

  // For each file with tracked functions, parse and find call expressions
  for (const [filePath, fileFunctions] of fileChunks) {
    const langConfig = getLanguageForFile(filePath);
    if (!langConfig) continue;

    // Read current file content from the repo
    let content: string;
    try {
      const { readFileSync } = await import("node:fs");
      const { resolve } = await import("node:path");
      content = readFileSync(resolve(repoPath, filePath), "utf-8");
    } catch {
      continue; // File might not exist anymore
    }

    let tree: Tree;
    try {
      tree = await parseSource(content, langConfig);
    } catch {
      continue;
    }

    // For each function in this file, find what it calls
    const allChunks = extractChunks(tree, filePath, langConfig);

    for (const chunk of allChunks) {
      const callerId = makeFunctionId(filePath, chunk.functionName);
      if (!graph.hasNode(callerId)) continue;

      // Find call expressions within this function's range
      const callNames = findCallsInRange(
        tree.rootNode,
        chunk.startLine - 1, // 0-indexed
        chunk.endLine - 1
      );

      for (const calledName of callNames) {
        // Skip self-calls and constructors
        if (calledName === chunk.functionName) continue;

        const targetIds = nameToIds.get(calledName);
        if (!targetIds) continue;

        for (const targetId of targetIds) {
          if (targetId === callerId) continue;
          if (!graph.hasEdge(callerId, targetId)) {
            graph.addEdge(callerId, targetId);
          }
        }
      }
    }
  }

  logger.info(
    `Call graph: ${graph.order} nodes, ${graph.size} edges`
  );

  return graph;
}

/**
 * Find function call names within a line range of the AST.
 */
function findCallsInRange(
  root: Node,
  startRow: number,
  endRow: number
): Set<string> {
  const calls = new Set<string>();

  function walk(node: Node): void {
    if (node.startPosition.row > endRow) return;
    if (node.endPosition.row < startRow) return;

    if (
      node.type === "call_expression" ||
      node.type === "invocation_expression"
    ) {
      const fn = node.childForFieldName("function");
      if (fn) {
        // Simple name: foo()
        if (fn.type === "identifier") {
          calls.add(fn.text);
        }
        // Member access: obj.foo() — take the method name
        else if (
          fn.type === "member_expression" ||
          fn.type === "member_access_expression"
        ) {
          const prop = fn.childForFieldName("name") ?? fn.childForFieldName("property");
          if (prop) calls.add(prop.text);
        }
      }
    }

    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child) walk(child);
    }
  }

  walk(root);
  return calls;
}
