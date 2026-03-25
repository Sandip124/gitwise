import { describe, it, expect } from "vitest";
import { classifyCommit } from "../../../src/core/commit-classifier.js";
import { CommitClassification } from "../../../src/core/types.js";

const { STRUCTURED, DESCRIPTIVE, NOISE } = CommitClassification;

describe("classifyCommit", () => {
  describe("STRUCTURED — conventional commits", () => {
    it.each([
      ["feat: add user authentication", STRUCTURED],
      ["fix: handle null token edge case", STRUCTURED],
      ["chore: update dependencies", STRUCTURED],
      ["docs: add API documentation", STRUCTURED],
      ["refactor(auth): simplify token validation", STRUCTURED],
      ["perf: optimize database query", STRUCTURED],
      ["test: add integration tests for login", STRUCTURED],
      ["build: update webpack config", STRUCTURED],
      ["ci: add GitHub Actions workflow", STRUCTURED],
      ["revert: revert commit abc123", STRUCTURED],
      ["fix!: breaking change in API", STRUCTURED],
      ["feat(payment): add Stripe integration", STRUCTURED],
    ])("classifies '%s' as STRUCTURED", (message, expected) => {
      expect(classifyCommit(message)).toBe(expected);
    });
  });

  describe("STRUCTURED — bracketed prefixes", () => {
    it.each([
      ["[BUGFIX] handle null pointer in parser", STRUCTURED],
      ["[FEATURE] add dark mode toggle", STRUCTURED],
      ["[HOTFIX] patch security vulnerability", STRUCTURED],
    ])("classifies '%s' as STRUCTURED", (message, expected) => {
      expect(classifyCommit(message)).toBe(expected);
    });
  });

  describe("DESCRIPTIVE — intent-carrying messages", () => {
    it.each([
      ["Add error handling for API timeouts", DESCRIPTIVE],
      ["Remove deprecated authentication method", DESCRIPTIVE],
      ["Fixed the race condition in payment processing", DESCRIPTIVE],
      ["Update user registration to validate email format", DESCRIPTIVE],
      ["Implement retry logic for failed webhook deliveries", DESCRIPTIVE],
      ["Prevent duplicate form submissions on slow networks", DESCRIPTIVE],
      ["Handle edge case where token expires during checkout", DESCRIPTIVE],
      ["Resolve conflict between auth middleware versions", DESCRIPTIVE],
    ])("classifies '%s' as DESCRIPTIVE", (message, expected) => {
      expect(classifyCommit(message)).toBe(expected);
    });
  });

  describe("DESCRIPTIVE — long messages with issue refs", () => {
    it.each([
      ["Address the timeout issue reported in #134", DESCRIPTIVE],
      ["Patch for PROJ-456 null reference bug", DESCRIPTIVE],
    ])("classifies '%s' as DESCRIPTIVE", (message, expected) => {
      expect(classifyCommit(message)).toBe(expected);
    });
  });

  describe("NOISE — meaningless messages", () => {
    it.each([
      ["wip", NOISE],
      ["WIP", NOISE],
      ["wip: saving progress", NOISE],
      ["fix", NOISE],
      ["update", NOISE],
      ["changes", NOISE],
      ["stuff", NOISE],
      ["misc", NOISE],
      ["temp", NOISE],
      [".", NOISE],
      ["...", NOISE],
      ["---", NOISE],
      ["xxx", NOISE],
      ["x", NOISE],
      ["a", NOISE],
      ["asdf", NOISE],
      ["aaa", NOISE],
      ["done", NOISE],
      ["save", NOISE],
      ["final", NOISE],
      ["commit", NOISE],
      ["initial commit", NOISE],
      ["", NOISE],
      ["  ", NOISE],
    ])("classifies '%s' as NOISE", (message, expected) => {
      expect(classifyCommit(message)).toBe(expected);
    });
  });

  describe("NOISE — merge commits", () => {
    it.each([
      ["Merge branch 'feature/auth' into main", NOISE],
      ["Merge pull request #42 from user/branch", NOISE],
      ["Merge remote-tracking branch 'origin/main'", NOISE],
    ])("classifies '%s' as NOISE", (message, expected) => {
      expect(classifyCommit(message)).toBe(expected);
    });
  });
});
