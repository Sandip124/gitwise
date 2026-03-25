import { LanguageConfig } from "../../core/types.js";

export const goConfig: LanguageConfig = {
  name: "go",
  extensions: [".go"],
  functionNodeTypes: ["function_declaration", "method_declaration"],
  classNodeTypes: ["type_declaration"],
  wasmName: "tree-sitter-go",
};
