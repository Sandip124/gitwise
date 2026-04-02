import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, relative } from "node:path";
import Database from "better-sqlite3";
import { FileHashStore } from "../db/file-hash-store.js";
import { isSupportedFile } from "../ast/languages/index.js";
import { logger } from "../shared/logger.js";

export interface ChangeSet {
  changedFiles: string[];   // Hash differs from stored
  addedFiles: string[];     // On disk but not in DB
  removedFiles: string[];   // In DB but not on disk
  unchangedFiles: string[]; // Hash matches
  rootChanged: boolean;     // Any changes at all
  fileContents: Map<string, string>; // Cached contents of changed/added files
}

const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", "bin", "obj",
  ".next", ".nuxt", "__pycache__", ".venv", "venv",
  "vendor", "coverage", ".wisegit",
]);

/**
 * Detect which files changed since the last index.
 * Uses SHA-256 content hashing — ~1ms per file.
 *
 * Returns a ChangeSet with cached file contents for changed/added files,
 * eliminating redundant reads in downstream operations.
 */
export function detectChanges(
  repoPath: string,
  db: Database.Database
): ChangeSet {
  const hashStore = new FileHashStore(db);
  const storedHashes = hashStore.getHashes(repoPath);

  const changedFiles: string[] = [];
  const addedFiles: string[] = [];
  const unchangedFiles: string[] = [];
  const fileContents = new Map<string, string>();
  const currentFiles = new Set<string>();

  // Walk directory tree, hash each supported file
  walkDir(repoPath, repoPath, (filePath, content) => {
    currentFiles.add(filePath);
    const hash = FileHashStore.computeHash(content);
    const stored = storedHashes.get(filePath);

    if (!stored) {
      addedFiles.push(filePath);
      fileContents.set(filePath, content);
    } else if (stored !== hash) {
      changedFiles.push(filePath);
      fileContents.set(filePath, content);
    } else {
      unchangedFiles.push(filePath);
    }

    // Update stored hash
    hashStore.upsertHash(repoPath, filePath, hash);
  });

  // Find removed files
  const removedFiles: string[] = [];
  for (const [storedPath] of storedHashes) {
    if (!currentFiles.has(storedPath)) {
      removedFiles.push(storedPath);
    }
  }

  // Clean up stale hashes
  if (removedFiles.length > 0) {
    hashStore.removeStale(repoPath, currentFiles);
  }

  const rootChanged = changedFiles.length > 0 || addedFiles.length > 0 || removedFiles.length > 0;

  logger.info(
    `Change detection: ${changedFiles.length} changed, ${addedFiles.length} added, ` +
    `${removedFiles.length} removed, ${unchangedFiles.length} unchanged` +
    `${rootChanged ? "" : " (nothing changed)"}`
  );

  return {
    changedFiles,
    addedFiles,
    removedFiles,
    unchangedFiles,
    rootChanged,
    fileContents,
  };
}

function walkDir(
  baseDir: string,
  dir: string,
  callback: (relativePath: string, content: string) => void
): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.startsWith(".")) continue;
    if (SKIP_DIRS.has(entry)) continue;

    const fullPath = resolve(dir, entry);
    let stat;
    try {
      stat = statSync(fullPath);
    } catch {
      continue;
    }

    if (stat.isDirectory()) {
      walkDir(baseDir, fullPath, callback);
    } else if (stat.isFile() && isSupportedFile(entry)) {
      const relativePath = relative(baseDir, fullPath);
      try {
        const content = readFileSync(fullPath, "utf-8");
        callback(relativePath, content);
      } catch {
        // Skip unreadable files
      }
    }
  }
}
