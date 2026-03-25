import { describe, it, expect } from "vitest";
import { calculateFreezeScore } from "../../../src/core/freeze-calculator.js";
import {
  DecisionEvent,
  EventType,
  IntentConfidence,
  IntentSource,
  CommitClassification,
  RecoveryLevel,
} from "../../../src/core/types.js";

function makeEvent(overrides: Partial<DecisionEvent> = {}): DecisionEvent {
  return {
    repoPath: "/test/repo",
    commitSha: "abc123",
    eventType: EventType.FUNCTION_CHANGED,
    functionId: "file:test.ts::function:foo",
    filePath: "test.ts",
    functionName: "foo",
    commitMessage: "fix: handle edge case",
    author: "dev@test.com",
    authoredAt: new Date("2024-01-01"),
    classification: CommitClassification.STRUCTURED,
    intent: "Fixed edge case",
    intentSource: IntentSource.RULE,
    confidence: IntentConfidence.HIGH,
    metadata: {},
    ...overrides,
  };
}

describe("calculateFreezeScore", () => {
  it("returns zero score for empty events", () => {
    const result = calculateFreezeScore([]);
    expect(result.score).toBe(0);
    expect(result.recoveryLevel).toBe(RecoveryLevel.L3);
  });

  it("computes score from git signals", () => {
    const events = [
      makeEvent({ author: "dev1@test.com" }),
      makeEvent({ author: "dev2@test.com" }),
    ];

    const result = calculateFreezeScore(events);
    expect(result.score).toBeGreaterThan(0);
    expect(result.functionId).toBe("file:test.ts::function:foo");
  });

  it("increases score for reverts", () => {
    const baseEvents = [makeEvent()];
    const revertEvents = [
      makeEvent(),
      makeEvent({ commitMessage: "Revert: undo the change" }),
    ];

    const baseScore = calculateFreezeScore(baseEvents);
    const revertScore = calculateFreezeScore(revertEvents);

    expect(revertScore.score).toBeGreaterThan(baseScore.score);
  });

  it("increases score for verified keywords", () => {
    const plain = [makeEvent({ commitMessage: "update something" })];
    const verified = [
      makeEvent({ commitMessage: "verified fix for race condition" }),
    ];

    const plainScore = calculateFreezeScore(plain);
    const verifiedScore = calculateFreezeScore(verified);

    expect(verifiedScore.signalBreakdown.gitSignals).toBeGreaterThan(
      plainScore.signalBreakdown.gitSignals
    );
  });

  it("increases score for issue references", () => {
    const noRef = [makeEvent({ commitMessage: "update something" })];
    const withRef = [
      makeEvent({ commitMessage: "fix crash reported in #134" }),
    ];

    const noRefScore = calculateFreezeScore(noRef);
    const withRefScore = calculateFreezeScore(withRef);

    expect(withRefScore.signalBreakdown.gitSignals).toBeGreaterThan(
      noRefScore.signalBreakdown.gitSignals
    );
  });

  it("increases score for multiple contributors", () => {
    const single = [makeEvent({ author: "dev1@test.com" })];
    const multi = [
      makeEvent({ author: "dev1@test.com" }),
      makeEvent({ author: "dev2@test.com" }),
      makeEvent({ author: "dev3@test.com" }),
    ];

    const singleScore = calculateFreezeScore(single);
    const multiScore = calculateFreezeScore(multi);

    expect(multiScore.signalBreakdown.gitSignals).toBeGreaterThan(
      singleScore.signalBreakdown.gitSignals
    );
  });

  it("increases score for old stable code", () => {
    const recent = [
      makeEvent({ authoredAt: new Date() }),
    ];
    const old = [
      makeEvent({ authoredAt: new Date("2020-01-01") }),
    ];

    const recentScore = calculateFreezeScore(recent);
    const oldScore = calculateFreezeScore(old);

    expect(oldScore.signalBreakdown.gitSignals).toBeGreaterThan(
      recentScore.signalBreakdown.gitSignals
    );
  });

  it("uses provided optional signal scores", () => {
    const events = [makeEvent()];

    const withIssue = calculateFreezeScore(events, {
      issueSignalScore: 0.8,
    });
    const without = calculateFreezeScore(events);

    expect(withIssue.score).toBeGreaterThan(without.score);
  });

  it("clamps score to 0–1 range", () => {
    const events = [makeEvent()];

    const result = calculateFreezeScore(events, {
      issueSignalScore: 5, // Unrealistically high
      pagerank: 5,
      codeStructureScore: 5,
      testSignalScore: 5,
      naurScore: 5,
      arandaScore: 5,
    });

    expect(result.score).toBeLessThanOrEqual(1);
    expect(result.score).toBeGreaterThanOrEqual(0);
  });

  it("populates signal breakdown", () => {
    const events = [makeEvent()];
    const result = calculateFreezeScore(events);

    expect(result.signalBreakdown).toBeDefined();
    expect(typeof result.signalBreakdown.gitSignals).toBe("number");
    expect(typeof result.signalBreakdown.issueSignals).toBe("number");
    expect(typeof result.signalBreakdown.codeStructure).toBe("number");
  });
});
