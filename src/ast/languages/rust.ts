import { LanguageConfig } from "../../core/types.js";

export const rustConfig: LanguageConfig = {
  name: "rust",
  extensions: [".rs"],
  functionNodeTypes: ["function_item"],
  classNodeTypes: ["struct_item", "enum_item", "impl_item", "trait_item"],
  wasmName: "tree-sitter-rust",
};
