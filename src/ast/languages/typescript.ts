import { LanguageConfig } from "../../core/types.js";

export const typescriptConfig: LanguageConfig = {
  name: "typescript",
  extensions: [".ts", ".tsx"],
  functionNodeTypes: [
    "function_declaration",
    "method_definition",
    "arrow_function",
  ],
  classNodeTypes: ["class_declaration"],
  wasmName: "tree-sitter-typescript",
};
