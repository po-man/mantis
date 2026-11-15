import type { Config } from "../config.js";
import { AppError } from "../lib/errors.js";
import { truncate } from "../lib/text.js";
import type { NormalizedImage } from "./image.js";
import type {
  ChatClient,
  ChatMessage,
  CompleteOptions,
  OpenRouterResult,
  TokenUsage,
} from "./openrouter.js";
import type { PromptBundle } from "./prompt.js";
import { parseSvg, SvgParseError } from "./svg-parser.js";

export interface VectorizeDeps {
  config: Config;
  prompt: PromptBundle;
  client: ChatClient;
}

export interface VectorizeResult {
  svg: string;
  warnings: string[];
  model: string;
  usage: TokenUsage | null;
  attempts: number;
  promptVersion: string;
}

export type VectorizeContext = Pick<CompleteOptions, "requestId" | "logger">;

const USER_INSTRUCTION =
  "Vectorize the primary object in this image. Follow the system instructions exactly.";

const MAX_REPAIR_TOKENS = 32_768;
const MAX_REPAIR_CONTEXT_CHARS = 12_000;

export async function vectorizeImage(
  deps: VectorizeDeps,
  image: NormalizedImage,
  context: VectorizeContext = {},
): Promise<VectorizeResult> {
  const messages: ChatMessage[] = [
    { role: "system", content: deps.prompt.text },
    {
      role: "user",
      content: [
        { type: "text", text: USER_INSTRUCTION },
        { type: "image_url", image_url: { url: image.dataUrl } },
      ],
    },
  ];

  const maxAttempts = 1 + deps.config.retryOnInvalidSvg;
  let maxTokens = deps.config.openrouterMaxTokens;
  let lastError: SvgParseError | undefined;
  let lastResult: OpenRouterResult | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = await deps.client.complete(messages, {
      maxTokens,
      ...context,
    });
    lastResult = result;

    try {
      const parsed = parseSvg(result.content);
      return {
        svg: parsed.svg,
        warnings: parsed.warnings,
        model: result.model,
        usage: result.usage,
        attempts: attempt,
        promptVersion: deps.prompt.version,
      };
    } catch (error) {
      if (!(error instanceof SvgParseError)) {
        throw error;
      }

      lastError = error;
      if (attempt >= maxAttempts) {
        break;
      }

      if (error.code === "truncated" || result.finishReason === "length") {
        maxTokens = Math.min(maxTokens * 2, MAX_REPAIR_TOKENS);
      }

      messages.push({
        role: "assistant",
        content: truncate(result.content, MAX_REPAIR_CONTEXT_CHARS),
      });
      messages.push({
        role: "user",
        content:
          `Your previous response could not be parsed as a valid SVG ` +
          `(${error.code}: ${error.message}). Return ONLY the complete SVG ` +
          "markup inside a single ```xml code block. Do not include reasoning " +
          "or any other text.",
      });
    }
  }

  throw new AppError(
    "invalid_svg",
    `The model did not return a valid SVG after ${maxAttempts} attempt(s): ` +
      `${lastError?.code ?? "unknown"}`,
    422,
    {
      code: lastError?.code ?? "unknown",
      attempts: maxAttempts,
      finishReason: lastResult?.finishReason ?? null,
    },
  );
}
