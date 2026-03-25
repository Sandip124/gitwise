import { LanguageConfig } from "../../core/types.js";
import { typescriptConfig } from "./typescript.js";
import { javascriptConfig } from "./javascript.js";
import { pythonConfig } from "./python.js";
import { csharpConfig } from "./csharp.js";
import { goConfig } from "./go.js";
import { rustConfig } from "./rust.js";
import { extname } from "node:path";

const ALL_CONFIGS: LanguageConfig[] = [
  typescriptConfig,
  javascriptConfig,
  pythonConfig,
  csharpConfig,
  goConfig,
  rustConfig,
];

const extensionMap = new Map<string, LanguageConfig>();
for (const config of ALL_CONFIGS) {
  for (const ext of config.extensions) {
    extensionMap.set(ext, config);
  }
}

export function getLanguageForFile(filePath: string): LanguageConfig | null {
  const ext = extname(filePath).toLowerCase();
  return extensionMap.get(ext) ?? null;
}

export function getSupportedExtensions(): string[] {
  return [...extensionMap.keys()];
}

export function isSupportedFile(filePath: string): boolean {
  return getLanguageForFile(filePath) !== null;
}
