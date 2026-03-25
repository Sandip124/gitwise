import { LanguageConfig } from "../../core/types.js";

export const pythonConfig: LanguageConfig = {
  name: "python",
  extensions: [".py"],
  functionNodeTypes: ["function_definition"],
  classNodeTypes: ["class_definition"],
  wasmName: "tree-sitter-python",
};
