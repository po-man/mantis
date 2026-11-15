import type { Config } from "../config.js";
import { AppError } from "../lib/errors.js";
import { truncate } from "../lib/text.js";

export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string | ContentPart[];
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface OpenRouterResult {
  content: string;
  finishReason: string | null;
  usage: TokenUsage | null;
  model: string;
  latencyMs: number;
}

export interface UpstreamLogger {
  info(obj: Record<string, unknown>, msg?: string): void;
}

export interface CompleteOptions {
  maxTokens?: number;
  signal?: AbortSignal;
  requestId?: string;
  logger?: UpstreamLogger;
}

export interface ChatClient {
  complete(
    messages: ChatMessage[],
    options?: CompleteOptions,
  ): Promise<OpenRouterResult>;
}

type MessageContent =
  | string
  | Array<{ type?: string; text?: string }>
  | null
  | undefined;

interface OpenRouterResponse {
  model?: string;
  choices?: Array<{
    message?: {
      content?: MessageContent;
    };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

function extractContent(content: MessageContent): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part?.text === "string" ? part.text : ""))
      .join("");
  }
  return "";
}

function mapUsage(usage: OpenRouterResponse["usage"]): TokenUsage | null {
  if (!usage) {
    return null;
  }
  return {
    promptTokens: usage.prompt_tokens ?? 0,
    completionTokens: usage.completion_tokens ?? 0,
    totalTokens: usage.total_tokens ?? 0,
  };
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  );
}

export class OpenRouterClient implements ChatClient {
  constructor(private readonly config: Config) {}

  async complete(
    messages: ChatMessage[],
    options: CompleteOptions = {},
  ): Promise<OpenRouterResult> {
    const startedAt = performance.now();
    const url = `${this.config.openrouterBaseUrl.replace(/\/+$/, "")}/chat/completions`;

    const body: Record<string, unknown> = {
      model: this.config.openrouterModel,
      messages,
      temperature: this.config.openrouterTemperature,
      max_tokens: options.maxTokens ?? this.config.openrouterMaxTokens,
    };

    if (this.config.openrouterProvider) {
      try {
        body.provider = JSON.parse(this.config.openrouterProvider);
      } catch {
        throw new AppError(
          "config_error",
          "OPENROUTER_PROVIDER must be valid JSON",
          500,
        );
      }
    }

    const headers: Record<string, string> = {
      authorization: `Bearer ${this.config.openrouterApiKey}`,
      "content-type": "application/json",
      "x-title": this.config.openrouterAppTitle,
    };
    if (this.config.openrouterHttpReferer) {
      headers["http-referer"] = this.config.openrouterHttpReferer;
    }

    const timeoutSignal = AbortSignal.timeout(this.config.openrouterTimeoutMs);
    const signal = options.signal
      ? AbortSignal.any([timeoutSignal, options.signal])
      : timeoutSignal;

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal,
      });
    } catch (error) {
      if (isAbortError(error)) {
        throw new AppError(
          "upstream_timeout",
          "The OpenRouter request timed out",
          504,
        );
      }
      throw new AppError(
        "upstream_error",
        `The OpenRouter request failed: ${(error as Error).message}`,
        502,
      );
    }

    const raw = await response.text();

    if (!response.ok) {
      if (response.status === 429) {
        throw new AppError(
          "rate_limited",
          "OpenRouter rate limit exceeded",
          429,
        );
      }
      if (response.status === 401 || response.status === 403) {
        throw new AppError(
          "config_error",
          "OpenRouter rejected the configured API key",
          500,
        );
      }
      throw new AppError(
        "upstream_error",
        `OpenRouter returned HTTP ${response.status}: ${truncate(raw, 500)}`,
        502,
      );
    }

    let payload: OpenRouterResponse;
    try {
      payload = JSON.parse(raw) as OpenRouterResponse;
    } catch {
      throw new AppError(
        "upstream_error",
        "OpenRouter returned a non-JSON response",
        502,
      );
    }

    const choice = payload.choices?.[0];
    const content = extractContent(choice?.message?.content);
    const usage = mapUsage(payload.usage);
    const model = payload.model ?? this.config.openrouterModel;
    const latencyMs = Math.round(performance.now() - startedAt);

    options.logger?.info(
      {
        requestId: options.requestId,
        model,
        promptTokens: usage?.promptTokens ?? 0,
        completionTokens: usage?.completionTokens ?? 0,
        totalTokens: usage?.totalTokens ?? 0,
        latencyMs,
        finishReason: choice?.finish_reason ?? null,
        contentLength: content.length,
      },
      "openrouter call completed",
    );

    if (content.trim().length === 0) {
      throw new AppError(
        "upstream_error",
        "OpenRouter returned an empty response",
        502,
      );
    }

    return {
      content,
      finishReason: choice?.finish_reason ?? null,
      usage,
      model,
      latencyMs,
    };
  }
}
