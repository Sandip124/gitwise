# Contributing to wisegit

Thanks for your interest in contributing! wisegit is grounded in published software engineering research — contributions that maintain this standard are especially welcome.

## Getting Started

```bash
git clone https://github.com/Sandip124/wisegit.git
cd wisegit
npm install
npm test          # 100 unit tests
npm run lint      # TypeScript type-check
```

## Development

```bash
npm run cli -- init --full-history --path /path/to/repo   # Test indexing
npm run cli -- audit <file>                                # Test manifest
npm run cli -- report --path /path/to/repo                 # Test report
```

## Project Structure

```
src/
├── core/          # Domain logic (types, classifier, freeze calculator)
├── ast/           # Tree-sitter AST parsing + language configs
├── git/           # Git operations (log walker, diff parser, remote detector)
├── db/            # SQLite stores (events, chunks, freeze scores, overrides)
├── mcp/           # MCP server + 8 tools + resource template
├── cli/           # CLI commands (19 commands)
├── pipeline/      # Orchestration (init, recompute, sync, branch context)
├── graph/         # Call graph, PageRank, theory holders, theory gaps
├── issues/        # GitHub/GitLab issue enrichment
├── llm/           # Ollama + MCP sampling for intent extraction
├── report/        # HTML report generator
└── shared/        # Config, logger, errors, JSONL, team types
```

## Adding a Language

1. Create `src/ast/languages/yourlang.ts` with Tree-sitter node types
2. Register in `src/ast/languages/index.ts`
3. Ensure the WASM grammar exists in `tree-sitter-wasms`

## Pull Request Guidelines

- Run `npm test` and `npm run lint` before submitting
- Keep PRs focused — one feature or fix per PR
- If adding a new signal to freeze score, cite the academic source
- If adding a new MCP tool, include input validation with Zod schemas

## Academic Standards

wisegit's freeze score signals are grounded in 12 published papers (see [REFERENCE.md](REFERENCE.md)). New signals should reference peer-reviewed research where possible. This isn't a hard requirement for all contributions, but it's what makes wisegit defensible.

## Security

If you discover a security vulnerability, please report it privately via [GitHub Security Advisories](https://github.com/Sandip124/wisegit/security/advisories/new) rather than opening a public issue.
