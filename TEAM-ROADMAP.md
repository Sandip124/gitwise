# wisegit — From Individual Tool to Team Infrastructure

## A Roadmap for Making Decision Protection Work Across Teams

---

## 1. Where wisegit Is Today

wisegit currently works as a **per-developer, per-machine tool**. You run `npx wisegit setup` in a repo, it creates `~/.wisegit/wisegit.db` (SQLite), indexes your git history, and serves decision manifests via MCP. The architecture is clean and the developer experience is excellent — zero config, zero external services, 462 commits indexed in 13 seconds.

But there's a structural limitation: **the decision knowledge lives in a local database that no one else on the team can see.**

When Developer A runs `wisegit enrich` and discovers that Issue #134 was closed as "Won't Fix" — boosting `processPayment()`'s freeze score by +0.35 — Developer B doesn't know this happened. When Developer A creates an override with `wisegit override processPayment --reason "Stripe fixed webhook timing"`, Developer B's Claude Code session still shows `processPayment()` as FROZEN. The team is making decisions about the same codebase with different information.

This is the exact problem Naur [2] described: a program's theory exists in the minds of the team, and when that theory isn't shared, decay occurs. wisegit captures the theory from git history — but right now it captures it into isolated local databases instead of a shared team resource.

---

## 2. The Three-Layer Architecture

### Layer 1: Deterministic Base (Already Shared via Git)
Every developer who runs `wisegit init` produces the same decision events for deterministic signals.

### Layer 2: Shared Team Knowledge (`.wisegit/` Directory)
JSONL files tracked by git containing enrichments, intents, overrides, and branch contexts.

### Layer 3: Local Cache (Derived, Never Shared)
SQLite at `~/.wisegit/wisegit.db` — rebuilt from git history + `.wisegit/` files.

---

## Implementation Phases

### Phase A: Shared Knowledge Layer — ACTIVE
### Phase B: Team-Aware Manifests
### Phase C: AI-Era Adaptations
### Phase D: Advanced Team Features

See the full roadmap document for detailed specifications.

---

## References

[1]-[11] See REFERENCE.md for full academic citations.
