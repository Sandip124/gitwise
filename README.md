# wisegit

> *"Don't take a fence down until you know the reason it was put up."*
> — G.K. Chesterton

**wisegit** is a local MCP server that extracts decision intent from git history and protects intentional code from AI modification.

When Claude Code (or any MCP-compatible agent) is about to edit a file, wisegit injects a **decision manifest** showing which functions are frozen, stable, or open — so the AI respects what was intentional, not just what compiles.

**Zero config. Zero external services. Everything local.**

## The Problem

LLMs have no concept of **intentional code**. A manually-tested fix and a broken stub look identical — both are just text. Real scenario:

1. You fix a Stripe race condition with `sleep(350)` — manually tested, committed.
2. Next session: "find bugs." Claude removes `sleep(350)` — looks like dead code.
3. Production incident.

**Root cause:** git history contains proof of intention. Nobody extracts it.

## How It Works

```
Git History → Tree-sitter AST → Intent Extraction → SQLite Event Store → MCP Tools
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

- **FROZEN** (score >= 0.80): Do not modify without explicit user approval
- **STABLE** (score 0.50-0.79): Proceed with caution, review intent first
- **OPEN** (score < 0.50): Safe to modify freely

## Quick Start

### Prerequisites

- Node.js >= 20

That's it. No Docker, no PostgreSQL, no external services.

### 1. Set Up a Repository (one command)

```bash
cd /path/to/your/repo
npx wisegit setup
```

This single command:
- Creates a local SQLite database at `~/.wisegit/wisegit.db`
- Indexes your entire git history (462 commits in ~13 seconds)
- Creates `.mcp.json` for Claude Code auto-discovery
- Creates `CLAUDE.md` rules that instruct AI to check before editing
- Adds `.mcp.json` to `.gitignore`

### 2. Enrich with Issue Context (optional)

```bash
# Fetch issue/PR details from GitHub/GitLab
GITHUB_TOKEN=ghp_... npx wisegit enrich
```

This fetches referenced issues (e.g., `#134` in commit messages), detects Won't Fix / By Design decisions, and boosts freeze scores for functions linked to those issues.

### 3. Done

Open the repo in Claude Code. It will automatically:
1. Start the wisegit MCP server (via `.mcp.json`)
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
wisegit setup [--path <dir>] [--global]         # One-command repo setup
wisegit init [--full-history] [--path <dir>]     # Index git history
wisegit enrich [--path <dir>]                    # Fetch issue/PR context from GitHub/GitLab
wisegit audit <file>                             # Show decision manifest
wisegit history <target> [--file <path>]         # Show decision timeline
wisegit recompute [--path <dir>]                  # Recompute scores with PageRank + theory gaps
wisegit serve                                    # Start MCP server (stdio)
wisegit hook install|uninstall                   # Manage git hooks
```

## Configure for Claude Code

### Option A: Per-repo (recommended)

Run `npx wisegit setup` in any repo. It creates `.mcp.json` automatically.

### Option B: Global registration

```bash
claude mcp add wisegit -- npx wisegit serve
```

### Option C: Manual `.mcp.json`

Create `.mcp.json` in your repo root:

```json
{
  "wisegit": {
    "command": "npx",
    "args": ["wisegit", "serve"]
  }
}
```

## Supported Languages

| Language | Extensions |
|----------|-----------|
| C# | `.cs` |
| TypeScript | `.ts`, `.tsx` |
| JavaScript | `.js`, `.jsx`, `.mjs`, `.cjs` |
| Python | `.py` |
| Go | `.go` |
| Rust | `.rs` |

More languages can be added via Tree-sitter grammar configs in `src/ast/languages/`.

## Issue Enrichment

A commit saying `fix: handle null token #134` points to an issue containing reproduction steps, root cause, and explicit decision rationale — everything the commit message never says.

```bash
# Fetch issue context from GitHub/GitLab
wisegit enrich --path /path/to/repo

# With auth (5000 req/hr instead of 60)
GITHUB_TOKEN=ghp_... wisegit enrich
```

**Supported platforms:** GitHub, GitLab (Azure DevOps, Jira, Bitbucket planned)

**Auth tokens:** `GITHUB_TOKEN` / `GH_TOKEN` for GitHub, `GITLAB_TOKEN` for GitLab. Never stored by wisegit.

### Issue-derived freeze signals

| Signal | Freeze Boost | When |
|--------|-------------|------|
| Won't Fix / By Design | **+0.35** | Issue closed as `not_planned`, or has `wontfix`/`by-design` label, or comment says "intentional" |
| Reproduction steps | +0.15 | Issue body contains "steps to reproduce" |
| Platform-specific label | +0.10 | Issue labeled `ios`, `safari`, `windows`, etc. |
| Issue unreachable | +0.10 | Issue ref exists but API returned 404 — absent context = protect more |
| PR review comments | +0.15 | Linked PR had reviewer discussion |

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
│  wisegit MCP Server                             │
│  ┌──────────┐ ┌──────────┐ ┌─────────────────┐ │
│  │get_file_ │ │get_freeze│ │search_decisions │ │
│  │decisions │ │_score    │ │                 │ │
│  └────┬─────┘ └────┬─────┘ └───────┬─────────┘ │
└───────┼─────────────┼───────────────┼───────────┘
        │             │               │
┌───────▼─────────────▼───────────────▼───────────┐
│  SQLite (~/.wisegit/wisegit.db)                 │
│  ┌──────────────┐ ┌────────────┐ ┌───────────┐ │
│  │decision_events│ │freeze_scores│ │issue_     │ │
│  │(append-only) │ │(derived)   │ │enrichments│ │
│  └──────────────┘ └────────────┘ └─────┬─────┘ │
└────────────────────────────────────────┼────────┘
                                         │
┌────────────────────────────────────────▼────────┐
│  Issue Enrichment (wisegit enrich)              │
│  ┌─────────┐ ┌─────────┐ ┌──────────────────┐  │
│  │ GitHub  │ │ GitLab  │ │ Jira (planned)   │  │
│  │ REST API│ │ REST API│ │                  │  │
│  └─────────┘ └─────────┘ └──────────────────┘  │
└─────────────────────────────────────────────────┘
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `WISEGIT_DB_PATH` | `~/.wisegit/wisegit.db` | SQLite database path |
| `GITHUB_TOKEN` / `GH_TOKEN` | — | GitHub API token (5000 req/hr vs 60 unauthenticated) |
| `GITLAB_TOKEN` | — | GitLab API token for issue enrichment |
| `OLLAMA_URL` | `http://localhost:11434` | Ollama server URL (Phase 2) |
| `OLLAMA_CHAT_MODEL` | `llama3` | Model for intent extraction (Phase 2) |
| `OLLAMA_EMBED_MODEL` | `nomic-embed-text` | Model for embeddings (Phase 2) |

## Security

- **Everything runs locally** — only issue enrichment makes outbound API calls (opt-in via `wisegit enrich`)
- **Append-only event store** — decisions are never deleted, only added
- **SQLite database** stored at `~/.wisegit/wisegit.db` — no network exposure
- MCP tool inputs validated with strict Zod schemas (path traversal protection, length limits)
- Error messages sanitized before returning to MCP clients
- File writes check for symlinks before writing
- Config files parsed with allowlisted keys only (no prototype pollution)

## Roadmap

- [x] **Phase 1** — Event store, AST chunking, commit classification, intent extraction, MCP server, CLI
- [x] **Phase 1.5** — Issue enrichment (GitHub, GitLab) with Won't Fix/By Design detection, freeze boost signals
- [x] **Phase 2** — Full freeze score: call graph + PageRank, theory gap detection (Naur death, forgotten patterns), co-change signals, Aranda signals, Ollama client, Go + Rust support
- [ ] **Phase 4** — Override system, branch context preservation, merge conflict loss detection

## License

MIT
