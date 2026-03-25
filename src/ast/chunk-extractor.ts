import type { Tree, Node } from "web-tree-sitter";
import { FunctionChunk, LanguageConfig, makeFunctionId } from "../core/types.js";

/**
 * Extract function/method/class boundaries from a Tree-sitter tree.
 *
 * Per Giger et al. [6]: AST-level change type correlates more strongly with
 * bugs than raw line count. We extract at function boundary level.
 */
export function extractChunks(
  tree: Tree,
  filePath: string,
  config: LanguageConfig
): FunctionChunk[] {
  const chunks: FunctionChunk[] = [];
  const allNodeTypes = new Set([
    ...config.functionNodeTypes,
    ...config.classNodeTypes,
  ]);

  walkTree(tree.rootNode, (node) => {
    if (!allNodeTypes.has(node.type)) return;

    const name = extractName(node, config);
    if (!name) return;

    chunks.push({
      filePath,
      functionName: name,
      functionId: makeFunctionId(filePath, name),
      language: config.name,
      startLine: node.startPosition.row + 1, // 1-indexed
      endLine: node.endPosition.row + 1,
    });
  });

  return chunks;
}

/**
 * Extract the name of a function/method/class node.
 */
function extractName(node: Node, _config: LanguageConfig): string | null {
  // function_declaration, method_definition, class_declaration
  // → name child node
  const nameNode = node.childForFieldName("name");
  if (nameNode) {
    return nameNode.text;
  }

  // arrow_function assigned to a variable:
  //   const foo = () => { ... }
  //   variable_declarator -> name: identifier, value: arrow_function
  if (node.type === "arrow_function" && node.parent) {
    const parent = node.parent;

    // Direct: const foo = () => {}
    if (parent.type === "variable_declarator") {
      const varName = parent.childForFieldName("name");
      if (varName) return varName.text;
    }

    // Property: { foo: () => {} }
    if (parent.type === "pair") {
      const key = parent.childForFieldName("key");
      if (key) return key.text;
    }

    // Assignment: this.foo = () => {}
    if (parent.type === "assignment_expression") {
      const left = parent.childForFieldName("left");
      if (left) return left.text;
    }
  }

  return null;
}

/**
 * Walk all nodes in the tree, calling visitor for each.
 */
function walkTree(node: Node, visitor: (node: Node) => void): void {
  visitor(node);
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child) walkTree(child, visitor);
  }
}
