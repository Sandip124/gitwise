# gitwise — Project Reference

---

## One-Line Purpose

> *"Don't take a fence down until you know the reason it was put up."*
> — G.K. Chesterton [1]
>
> gitwise makes sure LLMs know why the fence is there before they touch it.

---

## What This Project Is

A local MCP server that extracts **decision intent** from git history and injects
it as structured context before any LLM touches a file — so it respects what was
intentional, not just what compiles.

**Philosophical and academic foundations:**

**Naur (1985) — "Programming as Theory Building" [2]**
> A program is not its source code. It is the shared mental model of why it exists.
> The death of a program happens when the team possessing its theory is dissolved.
> Decay occurs when modifications are made by programmers without a proper grasp
> of the underlying theory.

**Aranda & Venolia (2009) — "The Secret Life of Bugs" [3]**
> Electronic repositories were erroneous or misleading in 7 of 10 bugs studied,
> and incomplete in every single case. The rationale behind decisions — the "why"
> questions — were hardest to answer without direct human accounts.

**Kim et al. (2007) — "Predicting Faults from Cached History" [8]**
> A dynamic cache updated from change history localities predicts 73–95% of
> future faults — outperforming static models because it adapts to new change
> distributions as they arrive.

gitwise's job: reconstruct as much decision theory as possible from what was
recorded, be honest about what cannot be recovered, and treat both as protection.

---

## The Problem

LLMs have no concept of **intentional code**. To Claude Code, a manually-tested
verified fix and a broken stub look identical — both are just text. It optimizes
for "looks correct", not "was decided correct." [2]

**Real scenario:**
1. You fix a Stripe race condition with `sleep(350)` — manually tested, committed.
2. Next session: "find bugs." Claude removes `sleep(350)` — looks like dead code.
3. Production incident. You lose verified work. Cycle repeats.

**Root cause:** git history contains the proof of intention. Nobody extracts it.

**Academic validation:**
- Aranda & Venolia [3]: 23% of bug fixes had no link from bug record to source
  code commit. Corrective action descriptions missing or wrong 35% of the time.
- Hericko et al. [4]: commit messages alone are insufficient — models relying
  entirely on messages perform poorly when messages are incomplete or missing.
- Ying et al. [5]: critical dependencies between files exist that cannot be found
  by static or dynamic analysis — only change history reveals them.

---

## What Is NOT Being Built

| Discarded Feature | Why |
|---|---|
| Auto-generated CLAUDE.md | Claude Code's AutoDream agent prunes memory files — gitwise entries would be silently deleted. Conflict risk. |
| Semantic git history search as differentiator | Every competitor does this (`code-memory`, `git_blame_search`). Not a differentiator. |
| Pre-seed freeze scores on new code | Arbitrary scores without real history signals mean nothing. Fabricated confidence is worse than zero. |
| Constant "why did you do this?" prompts | Kills workflow. History already contains the answer. |
| Google-style inverted index as primary strategy | Wrong fit for a temporal problem. |
| CLAUDE.md integration | Owned storage (PostgreSQL event log) is more durable than files any agent can modify. |
| pgai in v1 | Adds complexity without capabilities pgvector alone cannot provide for v1. Resume-driven risk [1]. Defer to v2. |
| Swanson maintenance categories (corrective/adaptive/perfective) | gitwise doesn't classify maintenance type — it classifies intentionality and risk. Different downstream task from Hericko et al. [4]. |

---

## Core Features (Only These)

### 1. Intent Extraction — Why, Not What

Reads commit diff + message + surrounding code context.
Extracts 2–3 sentence structured intent summary. Raw diff discarded after extraction.

**Academic grounding:** Hericko et al. [4] proved that commit messages alone only
partially capture intent — the actual code changes carry semantic information that
messages miss. Models using diff-level analysis significantly outperform
message-only approaches. gitwise uses diffs as the primary signal.

**Commit classification runs before LLM extraction — rule-based, no GPU:**

- `STRUCTURED` — conventional prefix (`fix:`, `feat:`, `chore:`) → weak signal,
  diff is primary source of truth
- `DESCRIPTIVE` — plain sentence without prefix → use full message + diff
- `NOISE` — "wip", "x", "final", "aaa" → skip message, use diff + context only

**LLM (Ollama) runs only when needed [1]:**
- NOISE commits → Ollama extracts from diff shape
- CONFLICT commits → Ollama reconciles message vs diff
- STRUCTURED and DESCRIPTIVE → rule-based first; Ollama only if confidence LOW

Reduces first-run indexing time (~25 min → ~8 min on 3,000 commit repo).

**Fallback signal stack for NOISE commits:**
```
Layer 1: Commit message         (skip — unreliable [4])
Layer 2: Diff content           (what actually changed)
Layer 3: Surrounding code       (what the changed function does in context)
Layer 4: Historical pattern     (what happened to this code before [8])
```

**Confidence tags on every extraction:**

| Tag | Meaning |
|---|---|
| `HIGH` | Commit message + diff agree, clear intent |
| `MEDIUM` | Diff clear, message vague or missing |
| `LOW` | Both vague — inferred from diff shape only |
| `CONFLICT` | Message contradicts diff (e.g. "chore:" modifying frozen logic) |
| `ISSUE_ENRICHED` | Intent from issue body + comments — highest confidence tier |

`CONFLICT` academically validated: Aranda & Venolia [3] found resolution fields
wrong 10% of the time, corrective actions missing or wrong 35% of the time.
Informal commit messages are likely worse.

---

**Theory Gap Detection — from Aranda & Venolia [3]**

4-level framework for recovering intent history:
- Level 1: Automated bug/commit record data
- Level 2: Electronic traces (PRs, issue comments, emails)
- Level 3: Human sense-making across disconnected evidence
- Level 4: Direct participant interviews ← unrecoverable by automation

gitwise operates at Level 2–3. Level 4 is structurally unrecoverable.
Gaps surfaced explicitly rather than hidden:

```
⚠ THEORY GAP DETECTED: processPayment()
  Primary author john@company.com — last commit 18 months ago, no longer active.
  3 events in this function's history have no electronic trace
  (detected via timeline discontinuities).
  True rationale may be partially unrecoverable. [Naur death signal — Ref 2]
  Treat all logic here as intentional pending manual review.
  Recovery level: L2 — electronic traces only.
```

**Recovery level label on every manifest entry:**
```json
{
  "function": "processPayment",
  "freeze_score": 0.89,
  "recovery_level": "L2",
  "coverage_note": "Intent from electronic traces. Face-to-face decisions unrecoverable.",
  "confidence": "MEDIUM"
}
```

---

### 2. Issue Enrichment — Fetching the Full Story (Phase 1.5)

A commit saying `fix: handle null token #134` points to an issue containing
the reproduction steps, root cause, platform specifics, and explicit decision
rationale — everything the commit message never says.

**Academic grounding:** Aranda & Venolia [3]: 23% of bug fixes had no link from
bug record to source code. The inverse is equally true — many commits reference
issues with full context sitting in the tracker. Fetching this context moves
gitwise from Level 1 to Level 2–3 recovery.

**Domain coupling validation:** Aryani et al. [9] demonstrated that domain-level
information — the business meaning of what components do, what data fields they
share — predicts 65% of source code dependencies and 77% of database dependencies
*without accessing source code*. Issue tracker context ("Stripe race condition",
"Safari iOS null string") is exactly this kind of domain-level signal. When gitwise
enriches a commit with its issue body, it is recovering domain coupling information
that predicts real architectural dependencies.

**Platform support:**

| Platform | API | What gitwise fetches |
|---|---|---|
| GitHub | REST + GraphQL | Title, body, comments, labels, linked PRs, close event |
| GitLab | REST | Same + MR notes |
| Azure DevOps | REST | Work item, description, comments, acceptance criteria |
| Jira | REST | Description, comments, priority, resolution notes |
| Linear | REST | Description, comments, labels |
| Bitbucket | REST | Issues + PR descriptions |
| SVN | ❌ | Commit messages only — no enrichment possible |

**Platform detection from git remote URL — automatic.**

**Auth:** tokens in local keychain / `.env`. Never in gitwise storage.

**Graceful fallback:** unreachable issue → `ISSUE_UNREACHABLE` → +0.10 freeze
signal. From Aranda & Venolia [3]: absent context = protect more, not less.

**"Won't Fix" and "By Design" — strongest possible signal:**
```
Issue #892 resolution: Won't Fix
Comment: "This is intentional — Stripe race condition. Do not remove."

→ FROZEN: sleep(350)
  Source: Issue #892 — explicit Won't Fix decision
  Confidence: ISSUE_ENRICHED — direct human statement recovered
```

**New freeze signals from issue enrichment:**

| Signal | Weight | Source |
|---|---|---|
| Issue resolved Won't Fix / By Design | **+0.35** | Highest weight in system |
| Issue body has reproduction steps | +0.15 | Context depth |
| Issue has platform-specific label | +0.10 | Intentional edge case |
| Issue reference unreachable | +0.10 | Aranda [3]: absent = protect more |
| PR linked to issue has review comments | +0.15 | Reviewer-validated decision |

---

### 3. Freeze Score — Per Function, Derived Not Stored

Score **never stored directly**. Derived by replaying the event stream for that
function. Cached in materialized view, invalidated on new event.

**Academic grounding for the approach:**
Kim et al. [8]: *"The cache model is dynamic and adapts more quickly to new fault
distributions, since fault occurrences directly affect the model."* gitwise's
event sourcing + materialized view is the direct implementation of this insight —
the score recalculates from full history whenever new evidence arrives.

**All signal categories:**

#### Git History Signals
| Signal | Weight | Academic source |
|---|---|---|
| Revert count | +0.15 per revert | Kim et al. [8]: temporal locality |
| Commit keywords: verified, tested, stable | +0.10 | Aranda [3]: explicit documentation |
| Production incident reference (#issue) | +0.20 | Knab et al. [7]: past defects predict future |
| Contributor count | +0.05 per author | Aranda [3]: 26 people involved in 10 bugs |
| Age without modification (years stable) | +0.10 per year | Kim et al. [8]: temporal locality |
| Branch type: fix/, hotfix/ | +0.15 | Hericko et al. [4]: corrective commits |

#### Issue Enrichment Signals
| Signal | Weight | Academic source |
|---|---|---|
| Issue resolved Won't Fix / By Design | **+0.35** | Aranda [3]: explicit rationale |
| Issue body has reproduction steps | +0.15 | Aranda [3]: Level 2 evidence |
| Issue has platform-specific label | +0.10 | Ying et al. [5]: cross-platform surprise |
| Issue reference unreachable | +0.10 | Aranda [3]: absent context = protect |
| PR linked to issue has review comments | +0.15 | Aranda [3]: coordination evidence |

#### Code Structure Signals
| Signal | Weight | Academic source |
|---|---|---|
| Inline comment on same line | +0.20 | Naur [2]: theory leaks into text |
| Comment keywords: intentional, do not, hack | +0.30 | Naur [2]: explicit theory preservation |
| Magic number / non-obvious value (350ms) | +0.15 | Giger et al. [6]: semantic change type matters |
| Defensive pattern: double null, nested guard | +0.10 | Giger et al. [6]: `cond` changes high-risk |
| Try/catch wrapping specific operation | +0.10 | Giger et al. [6]: `stmt` with exception handling |
| Code contradicts surrounding style intentionally | +0.15 | Naur [2]: theory-consistent code |

#### Test Signals
| Signal | Weight | Academic source |
|---|---|---|
| Dedicated test exists for this function | +0.20 | Naur [2]: written theory evidence |
| Test has edge case label: "safari", "race condition" | +0.25 | Aranda [3]: platform-specific coordination |
| Test added in same commit as the code | +0.15 | Hericko et al. [4]: intent coherence |

#### Structural Importance Signals (Graph-derived)
| Signal | Weight | Academic source |
|---|---|---|
| Called from 10+ other functions | +0.15 | Kim et al. [8]: spatial locality |
| Public API / entry point | +0.15 | Giger et al. [6]: `func`/`mDecl` high correlation |
| Primary author no longer in repo — Naur death [2] | +0.20 | Naur [2]: theory dies with team |
| Stable file with high call count | +0.15 | Kim et al. [8]: changed-entity locality |

#### Naur Theory Signals [2]
| Signal | Weight |
|---|---|
| Pattern globally applied across codebase | +0.25 |
| Code contradicts best practice intentionally | +0.30 |
| Same pattern in 5+ files consistently | +0.20 |
| Removing requires changing 10+ call sites | +0.20 |

#### Aranda Signals [3]
| Signal | Weight |
|---|---|
| "Forgotten" pattern: burst of activity + 12mo silence without resolution | +0.20 |
| Timeline discontinuity (events with no electronic trace) | +0.15 |
| Link from commit to issue exists but broken | +0.10 |

#### Co-Change Signals — from Ying et al. [5] and Aryani et al. [9]
| Signal | Weight | Rationale |
|---|---|---|
| File changed together with frozen file 10+ times | +0.15 | Cross-language/cross-platform dependency [5] |
| File part of same branch as another frozen decision | +0.15 | Branch-level theory coherence [5] |
| Components share domain variables (issue labels, feature scope) | +0.15 | Domain coupling predicts architectural dependency [9] |

Ying et al. [5] showed that files changed together frequently reveal dependencies
that static analysis cannot find — cross-language, duplicate code bases, generated
files. Aryani et al. [9] strengthened this: domain-level coupling (shared business
concepts) predicts 65% of source code dependencies even without static analysis —
critical for hybrid/legacy systems. gitwise captures both via branch manifests,
co-change signals, and domain context from issue enrichment.

**Combined formula:**
```
freeze_score =
  (git_signals         × 0.20)
  + (issue_signals     × 0.20)
  + (code_structure    × 0.15)
  + (test_signals      × 0.15)
  + (structural        × 0.15)
  + (naur_theory       × 0.10)
  + (aranda_signals    × 0.05)
```

---

### 4. Decision Protection — Pre-Edit Injection

Decision manifest injected into LLM context before any file is read.

**Academic grounding:** Naur [2]: decay occurs when modifications are made without
a proper grasp of the underlying theory. The manifest gives the LLM that theory
before it touches the file — addressing the exact mechanism Naur identified.

```
[DECISION MANIFEST: payment.service.js]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FROZEN:  processPayment()  [score: 0.89] [Recovery: L2]
  - sleep(350)        → Issue #134: Stripe race condition. Won't Fix.
                        ISSUE_ENRICHED — direct human decision recovered.
  - !order.id == null → Safari iOS WebKit null string bug. Platform-specific.
                        MEDIUM — diff clear, message vague.
  - recursive retry   → replaces CPU-spiking while loop, load tested.
                        HIGH — commit message + diff agree.

⚠ THEORY GAP: Primary author inactive 18 months. Some decisions unrecoverable.

OPEN:    chargeCard()  [score: 0.21]  ← safe to modify
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

### 5. Legacy Codebase Safety

- **Diff shape analysis** — surgical change to untouched function = cautious freeze
- **Revert detection** — value changed, reverted, re-added = "fought over" [8]
- **Issue enrichment** — even "wip" commits with `#134` yield full issue context [3]
- **Merge conflict loss detection** — compares frozen functions pre/post merge
- **Semantic similarity threshold** — post-merge < 0.65 = reinitialization alert
- **"Forgotten" pattern** [3] — burst + 12mo silence without resolution = frozen
- **Co-change protection** [5] — file frequently changed with frozen file = flag

---

### 6. MCP Server + CLI — Two Interfaces, Not One

MCP is primary but **not the only interface**. MCP is currently in a hype cycle [1].
CLI fallback means the tool works regardless of protocol adoption.

**MCP tools:**
```
get_file_decisions(file)       → manifest + freeze scores + recovery levels
get_freeze_score(file, fn)     → score + reasoning + academic signal breakdown
search_decisions(query)        → BM25 + vector hybrid retrieval
```

**CLI fallback:**
```bash
gitwise audit <file>           # full manifest display
gitwise history <function>     # complete event timeline
gitwise override <function>    # intentional decision override
gitwise init --full-history    # first-run indexing
```

Everything local. Zero bytes sent to any external service.

---

## Intentional Override System

```bash
gitwise override processPayment --reason "Stripe fixed webhook timing upstream"
gitwise override payment.service.js:7 --reason "sleep removed, verified 2025-03-25"
gitwise override --branch feat/avalonia --reason "migrating to MAUI"
gitwise override processPayment --line 7 --keep-rest
```

**Rules:**
- Reason field mandatory. No reason = rejected.
- Shows what is being cleared + original intent before confirming.
- Inserts `FREEZE_OVERRIDE` event into append-only log permanently.
- New code: score starts at 0, grows from real history (no fabricated pre-seeding).
- Watch mode activated — LLM warned off during transition.
- Time-boxed: `--expires 7d` with expiry confirmation.

---

## Branch Context Preservation

Captured at merge time via post-merge hook.
Stored permanently, even after branch deletion:
```json
{
  "branch": "feat/avalonia",
  "merged": "2024-11-15",
  "purpose": "Full WinForms → Avalonia migration",
  "replaced": ["System.Windows.Forms", "MessageBox.Show()", "Form inheritance"],
  "new_standard": ["Avalonia", "ReactiveUI", "Window base class"],
  "do_not_reintroduce": ["Any System.Windows.Forms import"],
  "coverage": {
    "MainWindow.cs": "FULLY_MIGRATED",
    "NotificationService.cs": "PARTIAL — WinForms tray API retained intentionally",
    "BatteryReader.cs": "NOT_APPLICABLE"
  }
}
```

**Academic grounding:** Ying et al. [5] showed cross-language and duplicate
codebase dependencies are the most "surprising" and hardest to find by static
analysis — yet most valuable. Aryani et al. [9] validated this further:
domain-based coupling predicts 77% of database dependencies in hybrid/legacy
systems where static analysis fails entirely. Branch manifests are precisely the
mechanism for capturing both structural and domain-level decisions before the
branch is deleted.

Retroactive recovery for already-deleted branches:
```bash
gitwise recover-branch-context --from-mergecommit <sha>
# Recovers ~80% of context from merge commit metadata
```

---

## Indexing Strategy

| Strategy | Role | What it answers |
|---|---|---|
| **Event Sourcing** | Storage | How did this code evolve? |
| **AST + Tree-sitter** | Chunking | What is this function exactly? |
| **Graph + PageRank (Aider-style)** | Scoring | How load-bearing is this function? |
| **BM25 + Vector** | Retrieval | What decisions are relevant to this query? |

**Academic grounding for event sourcing:** Kim et al. [8]: *"The cache model is
dynamic — fault occurrences directly affect the model. This adaptation approach
results in better predictive power."* Static score tables cannot adapt; event
sourcing with derived views naturally adapts on every new commit.

**Academic grounding for AST chunking:** Giger et al. [6]: AST-level change type
(what kind of structural change occurred) correlates more strongly with bugs than
raw line count. gitwise uses Tree-sitter to identify change type at function
boundary level — the same insight operationalized for protection rather than prediction.

**Storage schema:**
```sql
CREATE TABLE decision_events (
  id          SERIAL,
  event_type  TEXT,       -- DECISION_MADE | DECISION_REVERTED | FREEZE_OVERRIDE
                          -- BRANCH_MERGED | CONFLICT_LOSS | WATCH_ACTIVATED
                          -- ISSUE_ENRICHED | THEORY_GAP_DETECTED
  function_id TEXT,       -- AST-resolved: file::function
  commit_sha  TEXT,
  author      TEXT,
  timestamp   TIMESTAMPTZ,
  payload     JSONB,      -- intent + signals + confidence + recovery_level + issue_ref
  vector      vector(768)
);

CREATE MATERIALIZED VIEW freeze_scores AS
  SELECT function_id, calculate_freeze_score(function_id) AS score
  FROM decision_events GROUP BY function_id;
-- Invalidated on new event — adapts dynamically [8]
```

**Query flow (~17ms total):**
```
BM25 filter on function_id + event_type   → 2ms
Vector ANN search within filtered set     → 8ms
Freeze score (materialized view)          → 1ms
Manifest assembly + recovery_level tag   → 1ms
```

---

## Update Mechanism

Per new commit (~2 seconds):
1. Tree-sitter parses changed functions — AST-level, not line-level [6]
2. Classify: STRUCTURED / DESCRIPTIVE / NOISE
3. Rule-based extraction first; Ollama only for NOISE + CONFLICT [4]
4. Issue enrichment: fetch `#ref` from remote platform if present [3]
5. Append new event → invalidate materialized view → score recalculates [8]

```bash
# .git/hooks/post-commit
gitwise index --commit HEAD
```

Full history scan on first install (~8 min for 3,000 commits):
```bash
gitwise init --full-history
```

---

## Stack

| Layer | Choice | Reason |
|---|---|---|
| Event store | PostgreSQL (append-only) | Dynamic adaptation [8]; durable |
| Vector search | pgvector | Co-located with event store |
| AST parsing | Tree-sitter | 40+ languages; AST-level changes [6] |
| Change distilling | ChangeDistiller (optional) | Validated tool from Giger et al. [6] |
| Dependency graph | NetworkX + PageRank | Structural importance signal [5] |
| Intent extraction | Ollama — llama3 | Local, NOISE/CONFLICT only [4] |
| Embeddings | Ollama — nomic-embed-text | Local, 768-dim |
| MCP server | Node.js | Claude Code native |
| Git parsing | simple-git (Node) | Lightweight |
| Issue APIs | GitHub/GitLab/Azure/Jira REST | Auto-detected from remote URL [3] |
| pgai | ❌ deferred to v2 | pgvector sufficient for v1 [1] |

---

## Build Phases

### Phase 1 — Event Store + AST Chunking
- [x] Tree-sitter: parse function boundaries per language (AST-level [6])
- [x] Git log walker: per-function diffs per commit
- [x] Commit classifier: STRUCTURED / DESCRIPTIVE / NOISE [4]
- [x] Rule-based intent extraction for STRUCTURED + DESCRIPTIVE
- [ ] Ollama for NOISE + CONFLICT only (Phase 2)
- [x] Append events to `decision_events`
- [x] `wisegit init --full-history`
- [x] MCP server with 3 tools (get_file_decisions, get_freeze_score, search_decisions)
- [x] CLI with setup, init, audit, history, serve, hook, enrich commands
- [x] SQLite event store (zero-config, no Docker required)

### Phase 1.5 — Issue Enrichment
- [x] Git remote URL → platform detector
- [x] GitHub / GitLab API clients
- [x] Local auth token via env vars (GITHUB_TOKEN, GITLAB_TOKEN)
- [x] Won't Fix / By Design → freeze signal +0.35 [3]
- [x] Broken link → ISSUE_UNREACHABLE → +0.10 [3]
- [x] `ISSUE_ENRICHED` event type
- [x] Reproduction steps detection → +0.15
- [x] Platform-specific label detection → +0.10
- [x] PR review comments signal → +0.15
- [x] `wisegit enrich` CLI command
- [x] Auto-recompute freeze scores after enrichment
- [ ] Azure DevOps / Jira / Bitbucket API clients (future)

### Phase 2 — Freeze Score
- [x] All signal categories with academic weights
- [x] `calculate_freeze_score(function_id)` event replay with full context
- [x] Graph + PageRank for structural importance [5][8]
- [x] Theory gap detection: Naur death signal (primary author inactive) [2]
- [x] Theory gap detection: timeline discontinuities [3]
- [x] "Forgotten" pattern: burst → silence without resolution [3]
- [x] Co-change signal: frequently co-changed functions [5][9]
- [x] Aranda signals: computed from event timeline [3]
- [x] Recovery level tagging: L1 / L2 / L3 per entry [3]
- [x] Ollama client for NOISE commit intent extraction [4]
- [x] Embedding generation for future semantic search
- [x] `wisegit recompute` CLI command
- [x] Go + Rust language support (6 languages total)
- [x] Ollama integration into init pipeline (opt-in via `--ollama` flag)

### Phase 3 — MCP Server + CLI
- [ ] `get_file_decisions` with recovery levels
- [ ] `get_freeze_score` with reasoning + signal breakdown
- [ ] `search_decisions` BM25 + vector hybrid
- [ ] `gitwise audit <file>` CLI
- [ ] `gitwise history <function>` CLI
- [ ] Post-commit hook installer

### Phase 4 — Override + Branch Context
- [ ] `gitwise override` with mandatory reason
- [ ] Watch mode on overridden functions [8]
- [ ] Time-boxed override + expiry prompt
- [ ] Post-merge hook for branch snapshot [5][9]
- [ ] `gitwise recover-branch-context`
- [ ] Merge conflict loss detector

### Phase 5 — Polish + Optional Enhancement
- [ ] README with Chesterton's Fence opener
- [ ] Demo GIF
- [ ] Optional: fine-tune Ollama on repo's own commit history [4]
  (Task-adaptive pre-training from Hericko et al. improves intent extraction
   significantly when trained on domain-specific diffs)

---

## Academic Defense Summary

gitwise is defensible at every layer:

| Claim | Evidence |
|---|---|
| Commit messages alone insufficient for intent | Hericko et al. [4] |
| AST-level diff analysis superior to line count | Giger et al. [6] |
| Change history reveals non-structural dependencies | Ying et al. [5] |
| Dynamic history-based protection outperforms static | Kim et al. [8] |
| Electronic repos incomplete in every bug case | Aranda & Venolia [3] |
| Rationale hardest to recover without human accounts | Aranda & Venolia [3] |
| Program decay = modification without theory grasp | Naur [2] |
| Past defects + incident links best predict future risk | Knab et al. [7] |
| Temporal + spatial locality are real and measurable | Kim et al. [8] |
| Domain coupling predicts dependencies without source analysis | Aryani et al. [9] |

---

## Recruiter Pitch

> *"Claude Code rewrote my manually-tested code because it had no memory of why
> decisions were made. I built a local MCP server backed by PostgreSQL and pgvector
> that treats git history as an event log — extracting decision intent from commits
> using a local LLM, enriching it with issue tracker context, and injecting a
> structured decision manifest before any LLM edits a file. It respects what was
> intentional, not just what compiles. Grounded in published software engineering
> research on fault prediction, commit intent classification, and change history
> mining. Fully offline. Nothing leaves your machine."*

---

## Competitive Position

| Capability | code-memory | git_blame_search | GCC | **gitwise** |
|---|---|---|---|---|
| Semantic git search | ✅ | ✅ | ❌ | ✅ |
| Local / offline | ✅ | partial | ❌ | ✅ |
| MCP + CLI fallback | ✅ | ✅ | ❌ | ✅ |
| AST-level change analysis [6] | ❌ | ❌ | ❌ | ✅ |
| Issue tracker enrichment [3][9] | ❌ | ❌ | ❌ | ✅ |
| Won't Fix / By Design signal | ❌ | ❌ | ❌ | ✅ |
| Freeze score per function | ❌ | ❌ | ❌ | ✅ |
| Intent extraction (why not what) | ❌ | ❌ | ❌ | ✅ |
| Co-change dependency protection [5][9] | ❌ | ❌ | ❌ | ✅ |
| Theory gap detection [3] | ❌ | ❌ | ❌ | ✅ |
| Recovery level labeling | ❌ | ❌ | ❌ | ✅ |
| Decision protection / pre-edit inject | ❌ | ❌ | ❌ | ✅ |
| Legacy codebase safety | ❌ | ❌ | ❌ | ✅ |
| Branch context preservation [5][9] | ❌ | ❌ | ❌ | ✅ |
| Override audit trail | ❌ | ❌ | ❌ | ✅ |
| Dynamic event sourcing [8] | ❌ | ❌ | partial | ✅ |

---

## References

[1] Software Hypes Course — ITU Copenhagen (Mircea F.).
    https://software-hypes.github.io/
    Source for: Chesterton's Fence (Lecture 2), MCP hype risk,
    resume-driven development, pgai deferral rationale.

[2] Peter Naur (1985). *Programming as Theory Building.*
    Microprocessing and Microprogramming, 15(5), 253–261.
    https://pages.cs.wisc.edu/~remzi/Naur.pdf
    Source for: theory decay, Naur death signal, theory signals in freeze score,
    the core philosophical justification for gitwise.

[3] Jorge Aranda & Gina Venolia (2009).
    *The Secret Life of Bugs: Going Past the Errors and Omissions
    in Software Repositories.* ICSE 2009, pp. 298–308.
    Source for: 4-level recovery framework, theory gap detection,
    23% missing issue→code link, "Forgotten" pattern, CONFLICT tag validation,
    broken link = protect more, Won't Fix = highest-signal human decisions.

[4] Tjaša Hericko, Boštjan Šumak, Sašo Karakatic (2024).
    *Commit-Level Software Change Intent Classification Using a Pre-Trained
    Transformer-Based Code Model.* Mathematics 2024, 12, 1012.
    https://doi.org/10.3390/math12071012
    Source for: commit message insufficiency, diff-level analysis superiority,
    task-adaptive pre-training for domain-specific intent extraction,
    NOISE commit handling, Ollama-only-when-needed design decision.

[5] Annie T.T. Ying, Gail C. Murphy, Raymond Ng, Mark C. Chu-Carroll (2004).
    *Predicting Source Code Changes by Mining Change History.*
    IEEE Transactions on Software Engineering, 30(9), 574–586.
    Source for: co-change signals, branch manifest design (cross-language /
    cross-platform "surprising" dependencies), non-structural dependency
    detection, Chesterton's Fence applied to code change prediction.

[6] Emanuel Giger, Martin Pinzger, Harald C. Gall (2011).
    *Comparing Fine-Grained Source Code Changes and Code Churn for Bug Prediction.*
    MSR 2011, pp. 83–92. https://doi.org/10.1145/1985441.1985456
    Source for: AST-level change type superiority over line count,
    `cond`/`func`/`mDecl` high-risk change categories, Tree-sitter chunking
    design, ChangeDistiller as validated tool, code structure signal weights.

[7] Patrick Knab, Martin Pinzger, Abraham Bernstein (2006).
    *Predicting Defect Densities in Source Code Files with Decision Tree Learners.*
    MSR 2006, pp. 119–125. https://doi.org/10.1145/1137983.1138012
    Source for: production incident links as strongest predictor,
    "yesterday's weather" (past bugs predict future), co-change strength
    correlation with defect density, modification report count dominance.

[8] Sunghun Kim, Thomas Zimmermann, E. James Whitehead Jr., Andreas Zeller (2007).
    *Predicting Faults from Cached History.* ICSE 2007, pp. 489–498.
    https://doi.org/10.1109/ICSE.2007.66
    Source for: FixCache as precedent for dynamic history-based protection,
    four locality types (temporal, spatial, changed-entity, new-entity),
    dynamic adaptation over static models, event sourcing design rationale,
    watch mode design, 10% cache → 73–95% fault coverage.

[9] Amir Aryani, Fabrizio Perin, Mircea Lungu, Andrea Caracciolo, Oscar Nierstrasz (2014).
    *Predicting Dependences Using Domain-Based Coupling.*
    Journal of Software: Evolution and Process, 26(12), 1126–1157.
    https://doi.org/10.1002/smr.1598
    Source for: domain-level coupling predicts 65% of source code dependencies
    and 77% of database dependencies without source access. Validates issue
    enrichment as domain-level signal recovery, branch context preservation
    for hybrid/legacy codebases, and co-change signals for components with
    no static dependency but shared domain variables. Average accuracy 0.73,
    93% of queries return at least one correct architectural dependency.
