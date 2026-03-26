# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.1.x   | Yes       |

## Reporting a Vulnerability

Please report security vulnerabilities privately via [GitHub Security Advisories](https://github.com/Sandip124/wisegit/security/advisories/new).

**Do not** open a public issue for security vulnerabilities.

You should receive an acknowledgment within 48 hours. We will work with you to understand the issue and coordinate a fix before public disclosure.

## Security Design

wisegit is designed with security as a priority:

- **Local-first:** All data stored in local SQLite (`~/.wisegit/wisegit.db`). No external database.
- **No shell execution:** All subprocess calls use `execFileSync` (argv array), never shell-interpreted strings.
- **Input validation:** All MCP tool inputs validated with Zod schemas — path traversal protection, length limits, null byte rejection.
- **Error sanitization:** Internal errors never exposed to MCP clients. Only `GitwiseError` messages returned; all others get generic message.
- **Symlink protection:** All file writes check for symlinks before writing.
- **Config validation:** `.gitwiserc.json` parsed with allowlisted keys only (no prototype pollution).
- **Token safety:** Auth tokens (GitHub, GitLab, npm, MCP registry) are gitignored and never committed.
- **Network access:** Only when user explicitly runs `wisegit enrich` (opt-in issue fetching from GitHub/GitLab API).

## Dependencies

wisegit uses `better-sqlite3` (native C++ binding) and `web-tree-sitter` (WASM). Supply chain scanner warnings about "native code" and "eval" are expected for these dependencies and are not vulnerabilities in wisegit's code.
