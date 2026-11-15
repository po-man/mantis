import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

export interface PromptBundle {
  /** Full prompt text sent as the system message. */
  text: string;
  /** Short content hash, exposed as X-Prompt-Version. */
  version: string;
  /** Absolute path the prompt was loaded from. */
  path: string;
}

export async function loadPrompt(promptPath: string): Promise<PromptBundle> {
  const absolutePath = path.resolve(promptPath);
  const text = (await readFile(absolutePath, "utf8")).trim();

  if (text.length === 0) {
    throw new Error(`Prompt file is empty: ${absolutePath}`);
  }

  const version = createHash("sha256").update(text).digest("hex").slice(0, 12);
  return { text, version, path: absolutePath };
}
