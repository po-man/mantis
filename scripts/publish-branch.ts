import { execFileSync } from "node:child_process";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildSite } from "./build-site.js";

export interface CreatePublishBranchOptions {
  name: string;
  rootDir?: string;
  sourceDir?: string;
  createTag?: boolean;
  push?: boolean;
}

export interface CreatePublishBranchResult {
  branch: string;
  tag: string | null;
  sourceBranch: string;
  commit: string;
  pushed: boolean;
}

function git(
  rootDir: string,
  args: string[],
  options: { allowFailure?: boolean } = {},
): string {
  try {
    return execFileSync("git", args, {
      cwd: rootDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    if (options.allowFailure) {
      return "";
    }
    const stderr = (error as { stderr?: Buffer | string }).stderr;
    const message =
      typeof stderr === "string"
        ? stderr.trim()
        : Buffer.isBuffer(stderr)
          ? stderr.toString("utf8").trim()
          : "";
    throw new Error(
      message || (error instanceof Error ? error.message : String(error)),
    );
  }
}

function gitSucceeds(rootDir: string, args: string[]): boolean {
  try {
    execFileSync("git", args, {
      cwd: rootDir,
      stdio: ["ignore", "ignore", "ignore"],
    });
    return true;
  } catch {
    return false;
  }
}

function validateRef(rootDir: string, ref: string, kind: "branch" | "tag"): void {
  const args =
    kind === "branch"
      ? ["check-ref-format", "--branch", ref]
      : ["check-ref-format", `refs/tags/${ref}`];
  if (!gitSucceeds(rootDir, args)) {
    throw new Error(`Invalid ${kind} name: ${ref}`);
  }
}

export async function createPublishBranch(
  options: CreatePublishBranchOptions,
): Promise<CreatePublishBranchResult> {
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const sourceDir = path.resolve(rootDir, options.sourceDir ?? ".publish");
  const name = options.name.trim();
  const createTag = options.createTag !== false;
  const tag = createTag ? name : null;

  validateRef(rootDir, name, "branch");
  if (tag) {
    validateRef(rootDir, tag, "tag");
  }

  const sourceBranch = git(rootDir, ["symbolic-ref", "--short", "-q", "HEAD"], {
    allowFailure: true,
  });
  if (!sourceBranch) {
    throw new Error("The current HEAD is detached; check out a branch first");
  }

  const trackedChanges = git(rootDir, [
    "status",
    "--porcelain",
    "--untracked-files=no",
  ]);
  if (trackedChanges.length > 0) {
    throw new Error(
      "Tracked files have uncommitted changes. Commit them before publishing.\n" +
        trackedChanges,
    );
  }

  if (gitSucceeds(rootDir, ["show-ref", "--verify", "--quiet", `refs/heads/${name}`])) {
    throw new Error(`Branch already exists: ${name}`);
  }
  if (tag && gitSucceeds(rootDir, ["show-ref", "--verify", "--quiet", `refs/tags/${tag}`])) {
    throw new Error(`Tag already exists: ${tag}`);
  }

  await buildSite({
    rootDir,
    manifestPath: path.join(sourceDir, "selections.json"),
    check: true,
  });

  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "vector-publish-"));
  const worktree = path.join(temporaryRoot, "worktree");
  let worktreeAdded = false;
  let committed = false;

  try {
    git(rootDir, ["worktree", "add", "-b", name, worktree, "HEAD"]);
    worktreeAdded = true;

    const targetDir = path.join(worktree, "publish");
    await cp(sourceDir, targetDir, { recursive: true });

    git(worktree, ["add", "publish"]);
    git(worktree, ["commit", "-m", `publish: ${name}`]);
    committed = true;
    const commit = git(worktree, ["rev-parse", "HEAD"]);

    if (tag) {
      git(worktree, ["tag", tag]);
    }

    git(rootDir, ["worktree", "remove", "--force", worktree]);
    worktreeAdded = false;
    await rm(temporaryRoot, { recursive: true, force: true });

    let pushed = false;
    if (options.push) {
      git(rootDir, ["push", "origin", `refs/heads/${name}:refs/heads/${name}`]);
      if (tag) {
        git(rootDir, ["push", "origin", `refs/tags/${tag}:refs/tags/${tag}`]);
      }
      pushed = true;
    }

    return {
      branch: name,
      tag,
      sourceBranch,
      commit,
      pushed,
    };
  } finally {
    if (worktreeAdded) {
      try {
        git(rootDir, ["worktree", "remove", "--force", worktree]);
      } catch {
        // Keep the original error.
      }
    }
    if (!committed) {
      try {
        git(rootDir, ["branch", "-D", name]);
      } catch {
        // The branch may not have been created.
      }
    }
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

function parseArgs(argv: string[]): CreatePublishBranchOptions {
  const options: { name?: string } & Omit<CreatePublishBranchOptions, "name"> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      const value = argv[index + 1];
      if (!value) throw new Error(`${arg} requires a value`);
      index += 1;
      return value;
    };
    switch (arg) {
      case "--name":
        options.name = next();
        break;
      case "--root":
        options.rootDir = next();
        break;
      case "--source":
        options.sourceDir = next();
        break;
      case "--no-tag":
        options.createTag = false;
        break;
      case "--push":
        options.push = true;
        break;
      case "--help":
      case "-h":
        console.log(
          "Usage: tsx scripts/publish-branch.ts --name publish.2026-11-16 " +
            "[--source .publish] [--no-tag] [--push]",
        );
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }
  if (!options.name) {
    throw new Error("--name is required");
  }
  return options as CreatePublishBranchOptions;
}

const isMain =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMain) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const result = await createPublishBranch(options);
    console.log(
      `Created branch ${result.branch} from ${result.sourceBranch} ` +
        `at ${result.commit.slice(0, 7)}`,
    );
    if (result.tag) {
      console.log(`Created tag ${result.tag}`);
    }
    if (result.pushed) {
      console.log("Pushed the publication refs to origin.");
    } else {
      console.log("");
      console.log("Push with:");
      console.log(`  git push origin refs/heads/${result.branch}:refs/heads/${result.branch}`);
      if (result.tag) {
        console.log(`  git push origin refs/tags/${result.tag}:refs/tags/${result.tag}`);
      }
    }
  } catch (error) {
    console.error(
      `error: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}
