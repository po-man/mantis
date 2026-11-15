import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

export interface PromptBundle {
  /** Full prompt text sent as the system message. */
  text: string;
  /** Short content hash, exposed as X-Prompt-Version. */
  version: string;
  /** Absolute path the prompt was loaded from. */
  path: string;
}

async function resolvePromptPath(
  promptDir: string,
  version: string,
): Promise<string> {
  const absoluteDir = path.resolve(promptDir);

  let entries;
  try {
    entries = await readdir(absoluteDir, { withFileTypes: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to read prompt directory ${absoluteDir}: ${message}`);
  }

  const matches = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => entry.name)
    .filter(
      (name) => name === `${version}.md` || name.startsWith(`${version}-`),
    )
    .sort();

  const [match, ...rest] = matches;

  if (match === undefined) {
    throw new Error(`Prompt version ${version} not found in ${absoluteDir}`);
  }
  if (rest.length > 0) {
    throw new Error(
      `Prompt version ${version} is ambiguous in ${absoluteDir}: ${matches.join(", ")}`,
    );
  }

  return path.join(absoluteDir, match);
}

export async function loadPrompt(
  promptDir: string,
  version: string,
): Promise<PromptBundle> {
  const absolutePath = await resolvePromptPath(promptDir, version);
  const text = (await readFile(absolutePath, "utf8")).trim();

  if (text.length === 0) {
    throw new Error(`Prompt file is empty: ${absolutePath}`);
  }

  const promptHash = createHash("sha256").update(text).digest("hex").slice(0, 12);
  return { text, version: promptHash, path: absolutePath };
}
