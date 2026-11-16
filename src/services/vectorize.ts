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
import { deriveParallaxRig, type ParallaxRig } from "./parallax.js";
import { parseSvg, SvgParseError } from "./svg-parser.js";

export interface VectorizeDeps {
  config: Config;
  prompt: PromptBundle;
  client: ChatClient;
}

export interface LlmCallMetric {
  attempt: number;
  model: string;
  latencyMs: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  finishReason: string | null;
  contentLength: number;
}

export interface VectorizeResult {
  svg: string;
  rig: ParallaxRig;
  warnings: string[];
  model: string;
  usage: TokenUsage | null;
  attempts: number;
  promptVersion: string;
  calls: LlmCallMetric[];
  stats: {
    bytes: number;
    elements: number;
    paths: number;
    rigNodes: number;
    idleNodes: number;
  };
}

export function aggregateUsage(calls: LlmCallMetric[]): TokenUsage | null {
  if (calls.length === 0) {
    return null;
  }
  return calls.reduce<TokenUsage>(
    (total, call) => ({
      promptTokens: total.promptTokens + call.promptTokens,
      completionTokens: total.completionTokens + call.completionTokens,
      totalTokens: total.totalTokens + call.totalTokens,
    }),
    { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
  );
}

export type VectorizeContext = Pick<CompleteOptions, "requestId" | "logger">;

const USER_INSTRUCTION =
  "Vectorize the primary object in this image. Follow the system instructions exactly.";

const MAX_REPAIR_TOKENS = 32_768;
const MAX_REPAIR_CONTEXT_CHARS = 12_000;

function emptyRig(warning: string): ParallaxRig {
  return {
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
    warnings: [warning],
  };
}

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
  const calls: LlmCallMetric[] = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = await deps.client.complete(messages, {
      maxTokens,
      ...context,
    });
    lastResult = result;

    calls.push({
      attempt,
      model: result.model,
      latencyMs: result.latencyMs,
      promptTokens: result.usage?.promptTokens ?? 0,
      completionTokens: result.usage?.completionTokens ?? 0,
      totalTokens: result.usage?.totalTokens ?? 0,
      finishReason: result.finishReason,
      contentLength: result.content.length,
    });

    try {
      const parsed = parseSvg(result.content);
      let parallax;
      try {
        parallax = deriveParallaxRig(parsed.svg);
      } catch (error) {
        parallax = {
          svg: parsed.svg,
          rig: emptyRig(
            `parallax derivation failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
          ),
        };
      }
      return {
        svg: parallax.svg,
        rig: parallax.rig,
        warnings: [...parsed.warnings, ...parallax.rig.warnings],
        model: result.model,
        usage: aggregateUsage(calls),
        attempts: attempt,
        promptVersion: deps.prompt.version,
        calls,
        stats: {
          bytes: Buffer.byteLength(parallax.svg, "utf8"),
          elements: parsed.stats.elements,
          paths: parsed.stats.paths,
          rigNodes: parallax.rig.nodes.length,
          idleNodes: parallax.rig.nodes.filter(
            (node) => node.idle !== undefined,
          ).length,
        },
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
        // Never shrink the budget: a configured max_tokens above the repair cap
        // would otherwise be lowered by the retry and truncate again.
        maxTokens = Math.max(
          maxTokens,
          Math.min(maxTokens * 2, MAX_REPAIR_TOKENS),
        );
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
      calls,
      usage: aggregateUsage(calls),
    },
  );
}
