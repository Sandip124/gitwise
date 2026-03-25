import { describe, it, expect } from "vitest";
import { extractIntent } from "../../../src/core/intent-extractor.js";
import {
  CommitClassification,
  IntentConfidence,
  IntentSource,
} from "../../../src/core/types.js";

describe("extractIntent", () => {
  describe("STRUCTURED commits", () => {
    it("extracts intent from conventional commit", () => {
      const result = extractIntent(
        "fix(auth): handle null token edge case",
        CommitClassification.STRUCTURED
      );

      expect(result).not.toBeNull();
      expect(result!.intent).toContain("Fixed a defect");
      expect(result!.intent).toContain("auth");
      expect(result!.intent).toContain("handle null token edge case");
      expect(result!.source).toBe(IntentSource.RULE);
      expect(result!.confidence).toBe(IntentConfidence.HIGH);
    });

    it("extracts intent from feat commit", () => {
      const result = extractIntent(
        "feat: add Stripe payment integration",
        CommitClassification.STRUCTURED
      );

      expect(result!.intent).toContain("Added new capability");
      expect(result!.intent).toContain("add Stripe payment integration");
    });

    it("extracts issue references", () => {
      const result = extractIntent(
        "fix: handle null token #134",
        CommitClassification.STRUCTURED
      );

      expect(result!.intent).toContain("#134");
    });

    it("extracts intent from bracketed prefix", () => {
      const result = extractIntent(
        "[BUGFIX] handle null pointer in parser",
        CommitClassification.STRUCTURED
      );

      expect(result).not.toBeNull();
      expect(result!.intent).toContain("handle null pointer in parser");
      expect(result!.confidence).toBe(IntentConfidence.MEDIUM);
    });
  });

  describe("DESCRIPTIVE commits", () => {
    it("extracts intent from descriptive message", () => {
      const result = extractIntent(
        "Add error handling for API timeouts",
        CommitClassification.DESCRIPTIVE
      );

      expect(result).not.toBeNull();
      expect(result!.intent).toContain("Add error handling for API timeouts");
      expect(result!.source).toBe(IntentSource.RULE);
      expect(result!.confidence).toBe(IntentConfidence.MEDIUM);
    });

    it("boosts confidence for messages with body", () => {
      const result = extractIntent(
        "Add error handling for API timeouts\n\nThis prevents 500 errors when upstream is slow.",
        CommitClassification.DESCRIPTIVE
      );

      expect(result!.confidence).toBe(IntentConfidence.HIGH);
    });

    it("extracts issue references from descriptive commits", () => {
      const result = extractIntent(
        "Patch for PROJ-456 null reference bug",
        CommitClassification.DESCRIPTIVE
      );

      expect(result!.intent).toContain("PROJ-456");
    });
  });

  describe("NOISE commits", () => {
    it("returns null for noise commits", () => {
      const result = extractIntent("wip", CommitClassification.NOISE);
      expect(result).toBeNull();
    });

    it("returns null for empty noise", () => {
      const result = extractIntent("", CommitClassification.NOISE);
      expect(result).toBeNull();
    });
  });
});
