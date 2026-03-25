import { LanguageConfig } from "../../core/types.js";

export const javascriptConfig: LanguageConfig = {
  name: "javascript",
  extensions: [".js", ".jsx", ".mjs", ".cjs"],
  functionNodeTypes: [
    "function_declaration",
    "method_definition",
    "arrow_function",
  ],
  classNodeTypes: ["class_declaration"],
  wasmName: "tree-sitter-javascript",
};
