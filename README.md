# gitwise

> *"Don't take a fence down until you know the reason it was put up."*
> — G.K. Chesterton

**gitwise** is a local MCP server that extracts decision intent from git history and protects intentional code from AI modification.

When Claude Code (or any MCP-compatible agent) is about to edit a file, gitwise injects a **decision manifest** showing which functions are frozen, stable, or open — so the AI respects what was intentional, not just what compiles.

## The Problem

LLMs have no concept of **intentional code**. A manually-tested fix and a broken stub look identical — both are just text. Real scenario:

1. You fix a Stripe race condition with `sleep(350)` — manually tested, committed.
2. Next session: "find bugs." Claude removes `sleep(350)` — looks like dead code.
3. Production incident.

**Root cause:** git history contains proof of intention. Nobody extracts it.

## How It Works

```
Git History → Tree-sitter AST → Intent Extraction → PostgreSQL Event Store → MCP Tools
```

1. **Indexes your git history** — walks every commit, parses diffs at the AST level (function boundaries, not line counts)
2. **Classifies commits** — STRUCTURED (`fix:`, `feat:`), DESCRIPTIVE (plain sentences), or NOISE (`wip`, `x`)
3. **Extracts intent** — rule-based for structured/descriptive commits, LLM for noise (Phase 2)
4. **Computes freeze scores** — 0–1 per function, derived from git signals, contributor count, age, reverts, and more
5. **Serves decision manifests via MCP** — Claude Code calls `get_file_decisions` before editing any file

## What the AI Sees

```
[DECISION MANIFEST: payment.service.cs]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FROZEN:  ProcessPayment()  [score: 0.89] [Recovery: L1]
  - sleep(350) → Stripe race condition. Won't Fix.
    HIGH — commit a3f19b2

STABLE:  ValidateOrder()  [score: 0.55] [Recovery: L2]
  - Fixed null reference on Safari iOS WebKit.
    MEDIUM — commit 7c14694

OPEN:    FormatReceipt()  [score: 0.12] [Recovery: L3]
  ← safe to modify
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

- **FROZEN** (score ≥ 0.80): Do not modify without explicit user approval
- **STABLE** (score 0.50–0.79): Proceed with caution, review intent first
- **OPEN** (score < 0.50): Safe to modify freely

## Quick Start

### Prerequisites

- Node.js ≥ 20
- Docker (for PostgreSQL + pgvector)

### 1. Install

```bash
npm install -g gitwise-mcp
```

Or use without installing:

```bash
npx gitwise-mcp <command>
```

### 2. Start the Database

```bash
docker run -d --name gitwise-db \
  -e POSTGRES_DB=gitwise \
  -e POSTGRES_USER=gitwise \
  -e POSTGRES_PASSWORD=gitwise \
  -p 5433:5432 \
  pgvector/pgvector:pg16
```

### 3. Set Up a Repository

```bash
cd /path/to/your/repo
DATABASE_URL="postgresql://gitwise:gitwise@localhost:5433/gitwise" \
  npx gitwise-mcp setup
```

This single command:
- Runs database migrations
- Indexes your entire git history
- Creates `.mcp.json` for Claude Code auto-discovery
- Creates `CLAUDE.md` rules that instruct AI to check before editing
- Adds `.mcp.json` to `.gitignore`

### 4. Done

Open the repo in Claude Code. It will automatically:
1. Start the gitwise MCP server (via `.mcp.json`)
2. Read the protection rules (via `CLAUDE.md`)
3. Call `get_file_decisions` before editing any file

## MCP Tools

| Tool | Description |
|------|-------------|
| `get_file_decisions` | Get decision manifest for a file — freeze scores, intent history, recovery levels |
| `get_freeze_score` | Get score + signal breakdown for a specific function |
| `search_decisions` | Search past decisions by keyword across the entire repo |

## CLI Commands

```bash
gitwise init [--full-history] [--path <dir>]   # Index git history
gitwise audit <file>                            # Show decision manifest
gitwise history <target> [--file <path>]        # Show decision timeline
gitwise serve                                   # Start MCP server (stdio)
gitwise setup [--path <dir>] [--global]         # One-command repo setup
gitwise hook install|uninstall                  # Manage git hooks
```

## Configure for Claude Code

### Option A: Per-repo (recommended)

Run `gitwise setup` in any repo. It creates `.mcp.json` automatically.

### Option B: Global registration

```bash
claude mcp add gitwise \
  -e DATABASE_URL=postgresql://gitwise:gitwise@localhost:5433/gitwise \
  -- npx gitwise-mcp serve
```

### Option C: Manual `.mcp.json`

Create `.mcp.json` in your repo root:

```json
{
  "gitwise": {
    "command": "npx",
    "args": ["gitwise-mcp", "serve"],
    "env": {
      "DATABASE_URL": "postgresql://gitwise:gitwise@localhost:5433/gitwise"
    }
  }
}
```

## Supported Languages

| Language | Extensions | Status |
|----------|-----------|--------|
| C# | `.cs` | ✅ |
| TypeScript | `.ts`, `.tsx` | ✅ |
| JavaScript | `.js`, `.jsx`, `.mjs`, `.cjs` | ✅ |
| Python | `.py` | ✅ |

More languages can be added by creating a language config in `src/ast/languages/`.

## Freeze Score Signals

The freeze score is **never stored directly** — it's derived by replaying the event stream for each function. Signal categories:

| Category | Weight | Source |
|----------|--------|--------|
| Git History | 0.20 | Reverts, verified keywords, incident refs, contributor count, age |
| Issue Enrichment | 0.20 | Won't Fix/By Design, reproduction steps, platform labels |
| Code Structure | 0.15 | Inline comments, magic numbers, defensive patterns |
| Test Signals | 0.15 | Dedicated tests, edge case labels, co-committed tests |
| Structural Importance | 0.15 | Call count (PageRank), public API, author activity |
| Naur Theory | 0.10 | Global patterns, intentional contradictions, removal cost |
| Aranda Signals | 0.05 | Forgotten patterns, timeline gaps, broken issue links |

Academic grounding: 9 published papers. See [REFERENCE.md](REFERENCE.md) for full citations.

## Architecture

```
┌─────────────────────────────────────────────────┐
│  Claude Code / MCP Client                       │
│  ┌───────────────────────────────────────────┐  │
│  │ 1. Reads CLAUDE.md protection rules       │  │
│  │ 2. Calls get_file_decisions before edits  │  │
│  │ 3. Respects FROZEN / STABLE / OPEN        │  │
│  └───────────────────────────────────────────┘  │
└─────────────────┬───────────────────────────────┘
                  │ MCP (stdio)
┌─────────────────▼───────────────────────────────┐
│  gitwise MCP Server                             │
│  ┌──────────┐ ┌──────────┐ ┌─────────────────┐ │
│  │get_file_ │ │get_freeze│ │search_decisions │ │
│  │decisions │ │_score    │ │                 │ │
│  └────┬─────┘ └────┬─────┘ └───────┬─────────┘ │
└───────┼─────────────┼───────────────┼───────────┘
        │             │               │
┌───────▼─────────────▼───────────────▼───────────┐
│  PostgreSQL + pgvector                          │
│  ┌──────────────┐  ┌────────────┐  ┌─────────┐ │
│  │decision_events│  │freeze_scores│  │embeddings│ │
│  │(append-only) │  │(derived)   │  │(Phase 2)│ │
│  └──────────────┘  └────────────┘  └─────────┘ │
└─────────────────────────────────────────────────┘
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `postgresql://gitwise:gitwise@localhost:5433/gitwise` | PostgreSQL connection string |
| `OLLAMA_URL` | `http://localhost:11434` | Ollama server URL (Phase 2) |
| `OLLAMA_CHAT_MODEL` | `llama3` | Model for intent extraction (Phase 2) |
| `OLLAMA_EMBED_MODEL` | `nomic-embed-text` | Model for embeddings (Phase 2) |

## Security

- **Everything runs locally** — zero bytes sent to external services
- **Append-only event store** — decisions are never deleted, only added
- MCP tool inputs validated with strict Zod schemas (path traversal protection, length limits)
- Error messages sanitized before returning to MCP clients (no DB schema/credential leakage)
- File writes check for symlinks before writing
- `.gitwiserc.json` parsed with allowlisted keys only (no prototype pollution)
- Database credentials never embedded in `.mcp.json` (uses env var references)

## Roadmap

- [x] **Phase 1** — Event store, AST chunking, commit classification, intent extraction, MCP server, CLI
- [ ] **Phase 1.5** — Issue enrichment (GitHub, GitLab, Jira, Azure DevOps)
- [ ] **Phase 2** — Full freeze score (PageRank, theory gap detection, Ollama for NOISE commits, vector search)
- [ ] **Phase 4** — Override system, branch context preservation, merge conflict loss detection

## License

MIT
