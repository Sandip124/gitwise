export class GitwiseError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = "GitwiseError";
  }
}

export class DatabaseError extends GitwiseError {
  constructor(message: string) {
    super(message, "DATABASE_ERROR");
    this.name = "DatabaseError";
  }
}

export class NotAGitRepoError extends GitwiseError {
  constructor(path: string) {
    // Only include the basename to avoid leaking full directory structure
    const safePath = path.split("/").pop() ?? "unknown";
    super(`Not a git repository: ${safePath}`, "NOT_GIT_REPO");
    this.name = "NotAGitRepoError";
  }
}

export class MigrationError extends GitwiseError {
  constructor(message: string) {
    super(message, "MIGRATION_ERROR");
    this.name = "MigrationError";
  }
}

export class ParserError extends GitwiseError {
  constructor(message: string) {
    super(message, "PARSER_ERROR");
    this.name = "ParserError";
  }
}
