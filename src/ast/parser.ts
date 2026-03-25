import { Parser, Language, Tree } from "web-tree-sitter";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { LanguageConfig } from "../core/types.js";
import { ParserError } from "../shared/errors.js";

let parserReady = false;
const languageCache = new Map<string, Language>();

/**
 * Initialize web-tree-sitter. Must be called once before parsing.
 */
export async function initParser(): Promise<void> {
  if (parserReady) return;
  await Parser.init();
  parserReady = true;
}

/**
 * Load a language grammar (WASM) and cache it.
 */
async function loadLanguage(config: LanguageConfig): Promise<Language> {
  const cached = languageCache.get(config.name);
  if (cached) return cached;

  try {
    // tree-sitter-wasms provides prebuilt .wasm files
    const wasmDir = resolve(
      process.cwd(),
      "node_modules/tree-sitter-wasms/out/tree-sitter-wasms"
    );

    // Try TSX for TypeScript (handles both .ts and .tsx)
    let wasmPath: string;
    if (config.name === "typescript") {
      wasmPath = join(wasmDir, "tree-sitter-tsx.wasm");
    } else {
      wasmPath = join(wasmDir, `${config.wasmName}.wasm`);
    }

    const wasmBuffer = readFileSync(wasmPath);
    const language = await Language.load(wasmBuffer);
    languageCache.set(config.name, language);
    return language;
  } catch (err) {
    throw new ParserError(
      `Failed to load grammar for ${config.name}: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

/**
 * Parse source code into a Tree-sitter tree.
 */
export async function parseSource(
  code: string,
  config: LanguageConfig
): Promise<Tree> {
  if (!parserReady) {
    await initParser();
  }

  const language = await loadLanguage(config);
  const parser = new Parser();
  parser.setLanguage(language);

  const tree = parser.parse(code);
  if (!tree) {
    throw new ParserError(`Failed to parse source for language ${config.name}`);
  }

  return tree;
}
