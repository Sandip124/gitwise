import { LanguageConfig } from "../../core/types.js";

export const csharpConfig: LanguageConfig = {
  name: "csharp",
  extensions: [".cs"],
  functionNodeTypes: [
    "method_declaration",
    "constructor_declaration",
    "local_function_statement",
  ],
  classNodeTypes: ["class_declaration", "interface_declaration", "record_declaration"],
  wasmName: "tree-sitter-c_sharp",
};
