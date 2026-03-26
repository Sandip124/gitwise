# wisegit — From Individual Tool to Team Infrastructure

## A Roadmap for Making Decision Protection Work Across Teams

---

## 1. Where wisegit Is Today

wisegit works as a **zero-config MCP server** that extracts decision intent from git history and protects intentional code from AI modification. You run `npx wisegit setup` in any repo, it indexes your git history into SQLite, and serves decision manifests via MCP to Claude Code (or any MCP-compatible agent).

The `.wisegit/` directory — tracked by git — stores shared team knowledge: enrichments, overrides, intents, and branch contexts. Every developer on the team gets the same decision knowledge on `git pull`. No separate server, no database to share, no accounts to create.

### What has been built

| Component | Status | Details |
|-----------|--------|---------|
| Event store (SQLite) | Done | Append-only, zero-config, ~13s for 462 commits |
| AST parsing (Tree-sitter) | Done | 6 languages: C#, TypeScript, JavaScript, Python, Go, Rust |
| Commit classification | Done | STRUCTURED / DESCRIPTIVE / NOISE |
| Intent extraction | Done | Rule-based + MCP sampling (host LLM) + Ollama fallback |
| Freeze score (7 signal categories) | Done | Git signals, issue enrichment, code structure, test, structural, Naur, Aranda |
| Call graph + PageRank | Done | Structural importance via graphology |
| Theory gap detection | Done | Naur death, timeline discontinuities, forgotten patterns |
| Co-change signals | Done | Ying et al. [5] + Aryani et al. [9] |
| Issue enrichment | Done | GitHub + GitLab, Won't Fix detection, freeze boost signals |
| Override system | Done | Mandatory reason, time-boxed expiry, MCP create_override tool |
| Branch context preservation | Done | Post-merge hook, snapshot storage, recovery |
| Team shared layer (.wisegit/) | Done | JSONL files tracked by git, auto-sync on MCP calls |
| Theory holder tracking | Done | Per-function active/inactive contributors, risk levels |
| AI commit origin detection | Done | HUMAN / AI_REVIEWED / AI_UNREVIEWED with score modifiers |
| MCP server | Done | 8 tools + 1 resource template + 1 prompt |
| CLI | Done | 18 commands |

---

## 2. The Three-Layer Architecture

### Layer 1: Deterministic Base (Already Shared via Git)

Every developer who runs `wisegit init` on the same repo produces the **same** decision events for deterministic signals: commit classification, rule-based intent extraction, git history signals, AST function boundaries, code structure signals. This layer doesn't need team sharing — it's like git's object store.

### Layer 2: Shared Team Knowledge (`.wisegit/` Directory)

```
.wisegit/
├── config.json                # Team policy (thresholds, AI authors, expiry)
├── enrichments.jsonl          # Issue enrichment cache (append-only)
├── intents.jsonl              # LLM-extracted intents for NOISE commits
├── overrides.jsonl            # Override decisions (append-only audit trail)
└── branch-contexts.jsonl      # Branch merge snapshots
```

**Why JSONL?** One JSON object per line. Concurrent appends from different developers produce no git merge conflicts. When duplicates occur after merge, deduplication rules resolve them:

| Data type | Key | Conflict rule |
|-----------|-----|---------------|
| Enrichments | `issue_ref + platform` | First entry wins (factual, immutable) |
| Overrides | `function_id` | Latest `created_at` wins (most recent decision) |
| Intents | `commit_sha + function_id` | First entry wins |

### Layer 3: Local Cache (Derived, Never Shared)

SQLite at `~/.wisegit/wisegit.db` — rebuilt from:

```
Local SQLite = f(git history) + f(.wisegit/*.jsonl)
```

Auto-synced on every MCP tool call (< 1ms when nothing changed), on post-merge hook (after `git pull`), and manually via `wisegit sync`.

---

## 3. Team-Aware Decision Manifests

The manifest now includes theory holder context:

```
[DECISION MANIFEST: payment.service.cs]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FROZEN:  ProcessPayment()  [score: 0.89] [Recovery: L1]
  Theory holders: developer-a (active), developer-c (inactive 8mo)
  ⚠ Single point of theory failure — only 1 active contributor.
  - sleep(350) → Issue #134: Stripe race condition. Won't Fix.
    ISSUE_ENRICHED — enriched by developer-a on 2026-03-25

OVERRIDE:  ValidateOrder()  [score: 0.55 → overridden]
  Theory holders: developer-b (active), developer-a (active)
  ⚠ ACTIVE OVERRIDE: Migrating validation to new schema
    Expires: 2026-04-02. Treat as OPEN until expiry.

OPEN:    FormatReceipt()  [score: 0.12] [Recovery: L3]
  Theory holders: developer-a (active), developer-b (active)
  ← safe to modify
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

Theory holder risk levels:
- **Healthy** (2+ active): Theory is well-distributed, safer to modify
- **Fragile** (1 active): Single point of failure — proceed with caution
- **Critical** (0 active): Full Naur death — no one holds the theory

---

## 4. AI-Era Adaptations

### Commit Origin Detection

wisegit distinguishes between human decisions and AI-generated output:

| Origin | Detection | Score Modifier |
|--------|-----------|---------------|
| `HUMAN` | Author not in `ai_commit_authors` config | 1.0× (full weight) |
| `AI_REVIEWED` | AI author + Co-authored-by/Reviewed-by trailer | 0.8× |
| `AI_UNREVIEWED` | AI author, no review signal | 0.3× |

Configure AI authors in `.wisegit/config.json`:
```json
{
  "ai_commit_authors": ["dependabot[bot]", "github-actions[bot]", "renovate[bot]"]
}
```

### LLM Strategy

| Context | LLM Used | How |
|---------|----------|-----|
| Inside Claude Code | Host LLM (Claude) via MCP sampling | Zero setup |
| CLI with Ollama | Ollama (llama3) | `wisegit init --ollama` |
| CLI without Ollama | None | Rule-based extraction only |

---

## 5. Team Health Metrics

### Theory Distribution Index

```
wisegit team-health

  Total functions: 1652
  Healthy (2+ active holders): 28 (1.7%)
  Fragile (1 active holder):   989 (59.9%)
  Critical (0 active holders): 635 (38.4%)
```

### Team Status Overview

```
wisegit team-status

  Enrichment Coverage:
    Issues enriched: 189 / 247 (76.5%)
    Enriched by: developer-a, developer-b

  Active Overrides: 12
    8 approved, 3 pending, 1 expired

  Contributors:
    Active (6mo): 4
    Total: 7
```

---

## 6. Legacy Codebase Evolution

wisegit is designed for codebases that have accumulated years of intentional decisions. Per Távora [12]: the business rules in messy code are *correct and valuable*. The technical debt is in the structure, not the decisions. Rewriting risks losing the decisions while fixing the structure.

**The freeze score doesn't mean "never change this."** It means "this code carries intentional decisions — understand them before you change it, and here's what we know."

### How wisegit Enables Progressive Migration

| Stage | How wisegit helps |
|-------|-------------------|
| **Understand AS-IS** | `wisegit audit` shows what's intentional. `wisegit team-health` shows where institutional knowledge is lost. |
| **Protect during refactoring** | Manifests tell developers + AI which behaviors were deliberately chosen |
| **Record rationale** | Override reasons persist in `.wisegit/overrides.jsonl` permanently |
| **Preserve migration context** | Branch snapshots record what was replaced and what should never return |
| **Track cross-boundary deps** | Co-change signals detect coupling between legacy and replacement code [5] |

### Legacy-Specific Signals

| Signal | Weight | Why it matters for legacy |
|--------|--------|--------------------------|
| Forgotten pattern (burst + 12mo silence) | +0.20 | Bug fixed urgently, module never touched again. Fix is load-bearing. [3] |
| Timeline discontinuity | +0.15 | Changes before issue trackers. Gaps = protect more. [3] |
| All contributors inactive (full Naur death) | +0.30 | Original team gone. Nobody holds the theory. [2] |
| Code contradicts best practice intentionally | +0.30 | "Wrong" approach was chosen deliberately. [2] |
| Magic number / non-obvious value | +0.15 | Tuned constants from production experience. [6] |
| Branch `do_not_reintroduce` list | +0.35 | Pattern deliberately removed in migration. |

### The Blame-Free Approach

The freeze score carries no judgment about code quality — it measures **intentionality and risk**. The override system requires a reason but never blocks: wisegit's job is to inform, not to prevent. The append-only log ensures future team members can trace the full decision history.

---

## 7. What This Does NOT Change

- **Local-first architecture.** No server required. `.wisegit/` shared via git.
- **SQLite as the local engine.** Fast, zero-setup, becomes a cache.
- **MCP as the primary interface.** Manifest format gains team context but retains FROZEN/STABLE/OPEN.
- **Append-only event semantics.** Decisions never deleted, only added.
- **Academic grounding.** Every signal traces back to published research.

---

## 8. Implementation Status

| Phase | Status | Key Deliverables |
|-------|--------|-----------------|
| **A: Shared Knowledge Layer** | Done | `.wisegit/` directory, JSONL files, auto-sync, reconcile-based branch handling |
| **B: Team-Aware Manifests** | Done | Theory holders per function, risk levels, `team-status`, `team-health` |
| **C: AI-Era Adaptations** | Done | Commit origin detection, origin-weighted freeze scores |
| **D: Advanced Team Features** | Done | Override approval (approved_by field), team health metrics |

---

## References

[1] Software Hypes Course — ITU Copenhagen (Mircea F.)
[2] Peter Naur (1985). *Programming as Theory Building.*
[3] Jorge Aranda & Gina Venolia (2009). *The Secret Life of Bugs.*
[4] Tjaša Hericko et al. (2024). *Commit-Level Software Change Intent Classification.*
[5] Annie T.T. Ying et al. (2004). *Predicting Source Code Changes by Mining Change History.*
[6] Emanuel Giger et al. (2011). *Comparing Fine-Grained Source Code Changes and Code Churn.*
[7] Patrick Knab et al. (2006). *Predicting Defect Densities in Source Code Files.*
[8] Sunghun Kim et al. (2007). *Predicting Faults from Cached History.*
[9] Amir Aryani et al. (2014). *Predicting Dependences Using Domain-Based Coupling.*
[10] Silvia Abrahão et al. (2025). *Software Engineering by and for Humans in an AI Era.*
[11] Nitin Addla (2026). *AI-Driven Development Lifecycle (AI-DLC).*
[12] João Victor Dias Távora (2025). *Legacy System Reengineering and Refactoring.*

See [REFERENCE.md](REFERENCE.md) for full citations.
