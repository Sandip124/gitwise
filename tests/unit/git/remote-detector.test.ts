import { describe, it, expect } from "vitest";
import { parseRemoteUrl } from "../../../src/git/remote-detector.js";

describe("parseRemoteUrl", () => {
  it("parses GitHub HTTPS URL", () => {
    const info = parseRemoteUrl("https://github.com/Sandip124/wisegit.git");
    expect(info).not.toBeNull();
    expect(info!.platform).toBe("github");
    expect(info!.owner).toBe("Sandip124");
    expect(info!.repo).toBe("wisegit");
  });

  it("parses GitHub SSH URL", () => {
    const info = parseRemoteUrl("git@github.com:Sandip124/wisegit.git");
    expect(info).not.toBeNull();
    expect(info!.platform).toBe("github");
    expect(info!.owner).toBe("Sandip124");
    expect(info!.repo).toBe("wisegit");
  });

  it("parses GitHub URL without .git suffix", () => {
    const info = parseRemoteUrl("https://github.com/owner/repo");
    expect(info).not.toBeNull();
    expect(info!.repo).toBe("repo");
  });

  it("parses GitLab HTTPS URL", () => {
    const info = parseRemoteUrl("https://gitlab.com/group/project.git");
    expect(info).not.toBeNull();
    expect(info!.platform).toBe("gitlab");
    expect(info!.owner).toBe("group");
    expect(info!.repo).toBe("project");
  });

  it("parses Bitbucket URL", () => {
    const info = parseRemoteUrl("https://bitbucket.org/team/repo.git");
    expect(info).not.toBeNull();
    expect(info!.platform).toBe("bitbucket");
    expect(info!.owner).toBe("team");
    expect(info!.repo).toBe("repo");
  });

  it("parses Azure DevOps URL", () => {
    const info = parseRemoteUrl(
      "https://dev.azure.com/org/project/_git/repo"
    );
    expect(info).not.toBeNull();
    expect(info!.platform).toBe("azure");
    expect(info!.owner).toBe("org");
    expect(info!.repo).toBe("repo");
  });

  it("returns null for unknown URLs", () => {
    const info = parseRemoteUrl("https://custom-server.com/repo.git");
    expect(info).toBeNull();
  });
});
