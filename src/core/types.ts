// ── Enums ──

export enum CommitClassification {
  STRUCTURED = "STRUCTURED",
  DESCRIPTIVE = "DESCRIPTIVE",
  NOISE = "NOISE",
}

export enum IntentConfidence {
  HIGH = "HIGH",
  MEDIUM = "MEDIUM",
  LOW = "LOW",
  CONFLICT = "CONFLICT",
  ISSUE_ENRICHED = "ISSUE_ENRICHED",
}

export enum IntentSource {
  RULE = "RULE",
  LLM = "LLM",
  ISSUE = "ISSUE",
  OVERRIDE = "OVERRIDE",
}

export enum RecoveryLevel {
  L1 = "L1", // ≥0.8 — Frozen
  L2 = "L2", // 0.5–0.79 — Stable
  L3 = "L3", // <0.5 — Active
}

export enum EventType {
  FUNCTION_CHANGED = "FUNCTION_CHANGED",
  FUNCTION_CREATED = "FUNCTION_CREATED",
  FUNCTION_DELETED = "FUNCTION_DELETED",
  INTENT_EXTRACTED = "INTENT_EXTRACTED",
  COMMIT_CLASSIFIED = "COMMIT_CLASSIFIED",
  ISSUE_ENRICHED = "ISSUE_ENRICHED",
  FREEZE_OVERRIDE = "FREEZE_OVERRIDE",
  OVERRIDE_EXPIRED = "OVERRIDE_EXPIRED",
  MERGE_CONFLICT_LOSS = "MERGE_CONFLICT_LOSS",
  BRANCH_SNAPSHOT = "BRANCH_SNAPSHOT",
  THEORY_GAP_DETECTED = "THEORY_GAP_DETECTED",
}

// ── Core domain types ──

export interface DecisionEvent {
  id?: string;
  repoPath: string;
  commitSha: string;
  eventType: EventType;
  functionId: string | null;
  filePath: string;
  functionName: string | null;
  commitMessage: string | null;
  author: string | null;
  authoredAt: Date | null;
  classification: CommitClassification | null;
  intent: string | null;
  intentSource: IntentSource | null;
  confidence: IntentConfidence | null;
  metadata: Record<string, unknown>;
  createdAt?: Date;
}

export interface FunctionChunk {
  filePath: string;
  functionName: string;
  functionId: string; // "file:path::function:name"
  language: string;
  startLine: number;
  endLine: number;
  contentHash?: string;
}

export interface FreezeScore {
  functionId: string;
  filePath: string;
  functionName: string;
  score: number; // 0–1
  recoveryLevel: RecoveryLevel;
  signalBreakdown: SignalBreakdown;
  theoryGap: boolean;
  pagerank: number;
}

export interface SignalBreakdown {
  gitSignals: number;
  issueSignals: number;
  codeStructure: number;
  testSignals: number;
  structural: number;
  naurTheory: number;
  arandaSignals: number;
}

export interface IntentResult {
  intent: string;
  source: IntentSource;
  confidence: IntentConfidence;
}

// ── Git types ──

export interface DiffLine {
  type: "add" | "remove" | "context";
  content: string;
  oldLineNumber: number | null;
  newLineNumber: number | null;
}

export interface DiffHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: DiffLine[];
}

export interface FileDiff {
  oldPath: string;
  newPath: string;
  hunks: DiffHunk[];
  isNew: boolean;
  isDeleted: boolean;
  isRenamed: boolean;
}

export interface CommitInfo {
  sha: string;
  message: string;
  author: string;
  authorEmail: string;
  date: Date;
  parentSha: string | null;
}

// ── AST types ──

export interface LanguageConfig {
  name: string;
  extensions: string[];
  functionNodeTypes: string[];
  classNodeTypes: string[];
  wasmName: string;
}

// ── Manifest types (MCP output) ──

export interface DecisionManifest {
  filePath: string;
  functions: FunctionManifestEntry[];
  theoryGaps: TheoryGapEntry[];
}

export interface FunctionManifestEntry {
  functionName: string;
  functionId: string;
  freezeScore: number;
  recoveryLevel: RecoveryLevel;
  status: "FROZEN" | "STABLE" | "OPEN";
  decisions: DecisionEntry[];
}

export interface DecisionEntry {
  intent: string;
  confidence: IntentConfidence;
  source: IntentSource;
  commitSha: string;
  author: string | null;
  date: Date | null;
}

export interface TheoryGapEntry {
  functionName: string;
  reason: string;
  recoveryLevel: RecoveryLevel;
}

// ── Utility ──

export function makeFunctionId(filePath: string, functionName: string): string {
  return `file:${filePath}::function:${functionName}`;
}

export function parseFunctionId(
  functionId: string
): { filePath: string; functionName: string } | null {
  const match = functionId.match(/^file:(.+)::function:(.+)$/);
  if (!match) return null;
  return { filePath: match[1], functionName: match[2] };
}
