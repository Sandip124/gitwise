import { describe, it, expect } from "vitest";
import { extractIssueRefs } from "../../../src/issues/platform-detector.js";

describe("extractIssueRefs", () => {
  it("extracts GitHub-style #N references", () => {
    const refs = extractIssueRefs("fix: handle null token #134");
    expect(refs).toHaveLength(1);
    expect(refs[0].raw).toBe("#134");
    expect(refs[0].number).toBe(134);
    expect(refs[0].type).toBe("issue");
  });

  it("extracts multiple issue refs", () => {
    const refs = extractIssueRefs("fix #12 and #34, closes #56");
    expect(refs).toHaveLength(3);
    expect(refs.map((r) => r.raw)).toEqual(["#12", "#34", "#56"]);
  });

  it("extracts Jira-style PROJ-123 references", () => {
    const refs = extractIssueRefs("PROJ-456: fix null reference");
    expect(refs).toHaveLength(1);
    expect(refs[0].raw).toBe("PROJ-456");
    expect(refs[0].number).toBe(456);
    expect(refs[0].prefix).toBe("PROJ");
    expect(refs[0].type).toBe("ticket");
  });

  it("extracts GitLab MR references (!N)", () => {
    const refs = extractIssueRefs("merged !42 into main");
    expect(refs).toHaveLength(1);
    expect(refs[0].raw).toBe("!42");
    expect(refs[0].type).toBe("pr");
  });

  it("extracts cross-repo references", () => {
    const refs = extractIssueRefs("see owner/repo#99 for details");
    expect(refs).toHaveLength(1);
    expect(refs[0].raw).toBe("owner/repo#99");
    expect(refs[0].number).toBe(99);
    expect(refs[0].prefix).toBe("owner/repo");
  });

  it("deduplicates refs", () => {
    const refs = extractIssueRefs("fix #123, also related to #123");
    expect(refs).toHaveLength(1);
  });

  it("handles mixed ref types", () => {
    const refs = extractIssueRefs("fix #12 for PROJ-34, see !56");
    expect(refs).toHaveLength(3);
  });

  it("returns empty for no refs", () => {
    const refs = extractIssueRefs("chore: update dependencies");
    expect(refs).toHaveLength(0);
  });

  it("doesn't match HTML entities like &#123;", () => {
    const refs = extractIssueRefs("display &#123; correctly");
    expect(refs).toHaveLength(0);
  });
});
