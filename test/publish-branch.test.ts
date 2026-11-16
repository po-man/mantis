import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createPublishBranch } from "../scripts/publish-branch.js";

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="100%" height="100%">' +
  '<rect x="100" y="100" width="824" height="824" fill="#ccc"/></svg>';

const RIG = {
  format: "vector.parallax",
  version: 1,
  viewBox: [0, 0, 1024, 1024],
  cursor: { space: "normalized", neutral: [0.5, 0.5] },
  defaults: {
    shift: 40,
    scale: 0.06,
    rotate: 1.5,
    proximity: 0.55,
    direction: "inverse",
    neutralZ: 0.5,
  },
  nodes: [],
  anchors: [],
  synthetic: false,
  warnings: [],
};

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function setup() {
  const dir = mkdtempSync(path.join(tmpdir(), "vector-publish-branch-"));
  git(dir, "init", "-b", "main");
  git(dir, "config", "user.email", "test@example.com");
  git(dir, "config", "user.name", "Test User");
  writeFileSync(path.join(dir, "README.md"), "# test\n");
  git(dir, "add", "README.md");
  git(dir, "commit", "-m", "initial");

  const publishDir = path.join(dir, ".publish");
  mkdirSync(path.join(publishDir, "assets"), { recursive: true });
  writeFileSync(path.join(publishDir, "assets", "0011-input.png"), Buffer.from([1, 2, 3]));
  writeFileSync(path.join(publishDir, "assets", "0011.svg"), SVG);
  writeFileSync(path.join(publishDir, "assets", "0011.rig.json"), JSON.stringify(RIG));
  writeFileSync(
    path.join(publishDir, "selections.json"),
    JSON.stringify({
      format: "vector.publication",
      version: 1,
      title: "vector · selected results",
      intro: "A short publication intro.",
      generatedAt: "2026-11-16T00:00:00.000Z",
      items: [
        {
          id: 11,
          rating: "nice",
          title: "Conversion #11",
          model: "test/model",
          promptVersion: "v015",
          createdAt: 1,
          assets: {
            input: "assets/0011-input.png",
            svg: "assets/0011.svg",
            rig: "assets/0011.rig.json",
          },
        },
      ],
    }),
  );
  return dir;
}

describe("createPublishBranch", () => {
  it("commits the bundle on a publish branch without touching the current branch", async () => {
    const dir = setup();
    const before = git(dir, "rev-parse", "HEAD");
    const result = await createPublishBranch({
      rootDir: dir,
      name: "publish.2026-11-16",
      createTag: true,
    });

    expect(result.branch).toBe("publish.2026-11-16");
    expect(result.tag).toBe("publish.2026-11-16");
    expect(result.sourceBranch).toBe("main");
    expect(git(dir, "branch", "--show-current")).toBe("main");
    expect(git(dir, "rev-parse", "HEAD")).toBe(before);
    expect(git(dir, "rev-parse", "--verify", "refs/heads/publish.2026-11-16")).toBe(
      result.commit,
    );
    expect(git(dir, "rev-parse", "--verify", "refs/tags/publish.2026-11-16")).toBe(
      result.commit,
    );
    expect(
      git(
        dir,
        "show",
        "refs/heads/publish.2026-11-16:publish/selections.json",
      ),
    ).toContain('"rating":"nice"');
    expect(existsSync(path.join(dir, "publish"))).toBe(false);
    expect(existsSync(path.join(dir, ".publish", "selections.json"))).toBe(true);

    rmSync(dir, { recursive: true, force: true });
  });

  it("refuses to branch when tracked files are dirty", async () => {
    const dir = setup();
    writeFileSync(path.join(dir, "README.md"), "# dirty\n");
    await expect(
      createPublishBranch({ rootDir: dir, name: "publish.dirty" }),
    ).rejects.toThrow(/uncommitted changes/);
    rmSync(dir, { recursive: true, force: true });
  });
});
