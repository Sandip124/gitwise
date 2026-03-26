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

## Local Development (no npm publish needed)

### Option 1: Run directly from source

```bash
# Any wisegit command — just prefix with this:
node --import tsx/esm src/cli/index.ts <command>

# Examples:
node --import tsx/esm src/cli/index.ts setup --path /path/to/repo
node --import tsx/esm src/cli/index.ts audit src/some-file.ts --path /path/to/repo
node --import tsx/esm src/cli/index.ts report --path /path/to/repo
```

### Option 2: npm link (makes `wisegit` command globally available)

```bash
cd /path/to/wisegit
npm run build       # compile TypeScript to dist/
npm link            # creates global symlink

# Now use wisegit anywhere:
wisegit setup --path /path/to/any/repo
wisegit audit src/file.ts
wisegit report
```

To unlink: `npm unlink -g @sandip124/wisegit`

### Option 3: Test MCP server locally with Claude Code

Create `.mcp.json` in any repo pointing to your local source:

```json
{
  "wisegit": {
    "command": "node",
    "args": ["--import", "tsx/esm", "/absolute/path/to/wisegit/src/mcp/index.ts"]
  }
}
```

Open that repo in Claude Code — it will start your local MCP server. Changes to source are picked up on restart.

### Running tests

```bash
npm test              # 100 unit tests
npm run lint          # TypeScript type-check
npm run build         # Full compile to dist/
```

### Testing on a real repo

```bash
# Index a repo
node --import tsx/esm src/cli/index.ts init --full-history --path /path/to/repo

# Recompute with full signals (PageRank, theory gaps, co-change)
node --import tsx/esm src/cli/index.ts recompute --path /path/to/repo

# Enrich with GitHub issues
GITHUB_TOKEN=ghp_... node --import tsx/esm src/cli/index.ts enrich --path /path/to/repo

# Generate visual report
node --import tsx/esm src/cli/index.ts report --path /path/to/repo
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
