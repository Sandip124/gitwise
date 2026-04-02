import Database from "better-sqlite3";

/**
 * Find existing functions that solve a similar problem — the "memoization lookup."
 *
 * Uses BM25-like token scoring over function names, intents, and commit messages,
 * boosted by PageRank (structural importance). This prevents AI agents from
 * reimplementing functionality that already exists in the codebase.
 *
 * Per PLANSEARCH (Scale AI, ICLR 2025): "LLMs doing standard code generation
 * repeatedly sample highly similar, yet incorrect generations." Checking existing
 * solutions first converts the AI from greedy to DP-like behavior.
 */

interface SimilarFunction {
  functionName: string;
  filePath: string;
  score: number;
  matchReasons: string[];
  intent: string | null;
  freezeScore: number;
  pagerank: number;
}

export function findSimilarFunctions(
  db: Database.Database,
  description: string,
  repoPath?: string,
  limit: number = 8
): { results: SimilarFunction[]; formatted: string } {
  // Tokenize query: split on spaces, camelCase, snake_case, remove stopwords
  const queryTerms = tokenize(description);
  if (queryTerms.length === 0) {
    return { results: [], formatted: "No search terms provided." };
  }

  // Fetch all functions with their metadata
  const rows = db.prepare(`
    SELECT
      fc.function_id, fc.function_name, fc.file_path,
      COALESCE(fs.score, 0) as freeze_score,
      COALESCE(fs.pagerank, 0) as pagerank,
      (SELECT de.intent FROM decision_events de
       WHERE de.function_id = fc.function_id AND de.intent IS NOT NULL
       ORDER BY de.authored_at DESC LIMIT 1) as latest_intent,
      (SELECT de.commit_message FROM decision_events de
       WHERE de.function_id = fc.function_id AND de.commit_message IS NOT NULL
       ORDER BY de.authored_at DESC LIMIT 1) as latest_message
    FROM function_chunks fc
    LEFT JOIN freeze_scores fs ON fc.function_id = fs.function_id
    WHERE fc.repo_path = ?
  `).all(repoPath ?? "") as {
    function_id: string;
    function_name: string;
    file_path: string;
    freeze_score: number;
    pagerank: number;
    latest_intent: string | null;
    latest_message: string | null;
  }[];

  // Compute IDF (inverse document frequency) for each query term
  const docCount = rows.length || 1;
  const termDocFreq = new Map<string, number>();
  for (const term of queryTerms) {
    let df = 0;
    for (const row of rows) {
      const text = buildSearchText(row);
      if (text.includes(term)) df++;
    }
    termDocFreq.set(term, df);
  }

  // Score each function
  const scored: SimilarFunction[] = [];

  for (const row of rows) {
    const nameTokens = tokenize(row.function_name);
    const intentTokens = tokenize(row.latest_intent ?? "");
    const messageTokens = tokenize(row.latest_message ?? "");
    const allTokens = new Set([...nameTokens, ...intentTokens, ...messageTokens]);

    let score = 0;
    const matchReasons: string[] = [];

    for (const term of queryTerms) {
      const df = termDocFreq.get(term) ?? docCount;
      const idf = Math.log(docCount / Math.max(df, 1));

      // Name match (2x weight — strongest signal)
      if (nameTokens.includes(term)) {
        score += 2.0 * idf;
        if (!matchReasons.includes("name match")) matchReasons.push("name match");
      }

      // Intent match (1.5x weight — human-described purpose)
      if (intentTokens.includes(term)) {
        score += 1.5 * idf;
        if (!matchReasons.includes("intent match")) matchReasons.push("intent match");
      }

      // Commit message match (1x weight)
      if (messageTokens.includes(term)) {
        score += 1.0 * idf;
        if (!matchReasons.includes("commit history match")) matchReasons.push("commit history match");
      }
    }

    if (score <= 0) continue;

    // PageRank boost: central functions are more likely to be the canonical implementation
    score *= (1 + 0.3 * row.pagerank);

    // Freeze score boost: protected functions are verified implementations
    if (row.freeze_score > 0.3) {
      score *= (1 + 0.2 * row.freeze_score);
      matchReasons.push(`verified (score: ${row.freeze_score.toFixed(2)})`);
    }

    scored.push({
      functionName: row.function_name,
      filePath: row.file_path,
      score,
      matchReasons,
      intent: row.latest_intent,
      freezeScore: row.freeze_score,
      pagerank: row.pagerank,
    });
  }

  // Sort by score descending, take top K
  scored.sort((a, b) => b.score - a.score);
  const results = scored.slice(0, limit);

  // Format for MCP output
  const formatted = formatResults(description, results, queryTerms);
  return { results, formatted };
}

function buildSearchText(row: { function_name: string; latest_intent: string | null; latest_message: string | null }): string {
  return [row.function_name, row.latest_intent ?? "", row.latest_message ?? ""]
    .join(" ")
    .toLowerCase();
}

const STOPWORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "shall", "can", "to", "of", "in", "for",
  "on", "with", "at", "by", "from", "as", "into", "through", "during",
  "before", "after", "above", "below", "between", "and", "but", "or",
  "not", "no", "so", "if", "than", "that", "this", "it", "its",
  "function", "method", "class", "def", "return", "self", "new", "var",
  "let", "const", "import", "export", "from", "async", "await",
]);

function tokenize(text: string): string[] {
  if (!text) return [];

  return text
    // Split camelCase: processPayment → process, payment
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    // Split snake_case: find_or_create → find, or, create
    .replace(/_/g, " ")
    .toLowerCase()
    .split(/\W+/)
    .filter(t => t.length >= 2 && !STOPWORDS.has(t));
}

function formatResults(
  description: string,
  results: SimilarFunction[],
  queryTerms: string[]
): string {
  if (results.length === 0) {
    return [
      `No existing functions found matching: "${description}"`,
      "",
      "This appears to be new functionality. Proceed with implementation,",
      "but check the call graph to avoid duplicating logic in helper functions.",
    ].join("\n");
  }

  const lines = [
    `Existing implementations matching: "${description}"`,
    `Search terms: ${queryTerms.join(", ")}`,
    "\u2501".repeat(50),
    "",
  ];

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const status = r.freezeScore >= 0.8 ? "FROZEN" : r.freezeScore >= 0.5 ? "STABLE" : "OPEN";
    lines.push(`${i + 1}. ${r.functionName}()  [${status}]  ${r.filePath}`);
    lines.push(`   Match: ${r.matchReasons.join(", ")}`);
    if (r.intent) {
      lines.push(`   Intent: ${r.intent.slice(0, 150)}`);
    }
    lines.push("");
  }

  lines.push("\u2501".repeat(50));
  lines.push("Consider reusing these functions instead of writing new code.");
  lines.push("If none match, proceed — but ensure your new implementation");
  lines.push("follows the same patterns for consistency.");

  return lines.join("\n");
}
