import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadPrompt } from "../src/services/prompt.js";

const directories: string[] = [];

async function makePromptDir(files: Record<string, string>): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "vector-prompts-"));
  directories.push(directory);
  await Promise.all(
    Object.entries(files).map(([name, text]) =>
      writeFile(path.join(directory, name), text),
    ),
  );
  return directory;
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("loadPrompt", () => {
  it("selects a prompt by version prefix", async () => {
    const directory = await makePromptDir({
      "v001-vectorize.md": "  v001 prompt  \n",
      "v002-rig-ready.md": "v002 prompt",
    });

    const prompt = await loadPrompt(directory, "v001");

    expect(prompt.text).toBe("v001 prompt");
    expect(prompt.path).toBe(path.join(directory, "v001-vectorize.md"));
    expect(prompt.version).toHaveLength(12);
  });

  it("selects an exact version filename", async () => {
    const directory = await makePromptDir({ "v003.md": "exact prompt" });

    const prompt = await loadPrompt(directory, "v003");

    expect(prompt.text).toBe("exact prompt");
  });

  it("fails when the version is missing", async () => {
    const directory = await makePromptDir({
      "v002-rig-ready.md": "v002 prompt",
    });

    await expect(loadPrompt(directory, "v001")).rejects.toThrow(
      /Prompt version v001 not found/,
    );
  });

  it("fails when the version is ambiguous", async () => {
    const directory = await makePromptDir({
      "v001-a.md": "first",
      "v001-b.md": "second",
    });

    await expect(loadPrompt(directory, "v001")).rejects.toThrow(
      /Prompt version v001 is ambiguous/,
    );
  });

  it("fails when the prompt file is empty", async () => {
    const directory = await makePromptDir({ "v001-vectorize.md": "   \n" });

    await expect(loadPrompt(directory, "v001")).rejects.toThrow(
      /Prompt file is empty/,
    );
  });

  it("fails when the prompt directory cannot be read", async () => {
    await expect(loadPrompt("/does/not/exist", "v001")).rejects.toThrow(
      /Unable to read prompt directory/,
    );
  });
});
