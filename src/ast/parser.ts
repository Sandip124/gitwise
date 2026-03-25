import { Parser, Language, Tree } from "web-tree-sitter";
import { readFileSync, existsSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { LanguageConfig } from "../core/types.js";
import { ParserError } from "../shared/errors.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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
 * Resolve the tree-sitter-wasms directory.
 * Works whether gitwise is run from source, from dist/, or as an npm package.
 */
function resolveWasmDir(): string {
  // Method 1: resolve via require.resolve (works when installed as npm package)
  try {
    const require = createRequire(import.meta.url);
    const wasmPkg = require.resolve("tree-sitter-wasms/package.json");
    const dir = join(dirname(wasmPkg), "out");
    if (existsSync(dir)) return dir;
  } catch {
    // fallback
  }

  // Method 2: relative to this file (works from source or dist/)
  const candidates = [
    resolve(__dirname, "../../node_modules/tree-sitter-wasms/out"),
    resolve(__dirname, "../../../node_modules/tree-sitter-wasms/out"),
    resolve(process.cwd(), "node_modules/tree-sitter-wasms/out"),
  ];

  for (const dir of candidates) {
    if (existsSync(dir)) return dir;
  }

  throw new ParserError(
    "Could not find tree-sitter-wasms. Run: npm install tree-sitter-wasms"
  );
}

/**
 * Load a language grammar (WASM) and cache it.
 */
async function loadLanguage(config: LanguageConfig): Promise<Language> {
  const cached = languageCache.get(config.name);
  if (cached) return cached;

  try {
    const wasmDir = resolveWasmDir();

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
