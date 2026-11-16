import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Config } from "../config.js";
import { AppError, isAppError } from "../lib/errors.js";
import type { Semaphore } from "../lib/semaphore.js";
import { decodeImagePayload, normalizeImage } from "../services/image.js";
import type { ChatClient } from "../services/openrouter.js";
import type { PromptBundle } from "../services/prompt.js";
import type {
  ConversionInputImage,
  ConversionMetrics,
  ConversionStore,
} from "../services/store.js";
import {
  aggregateUsage,
  vectorizeImage,
  type LlmCallMetric,
  type VectorizeResult,
} from "../services/vectorize.js";

export interface VectorizeRouteDeps {
  config: Config;
  prompt: PromptBundle;
  promptId: number;
  client: ChatClient;
  semaphore: Semaphore;
  store: ConversionStore;
}

type OutputFormat = "svg" | "json";

function resolveFormat(request: FastifyRequest): OutputFormat {
  const query = request.query as { format?: string } | undefined;
  if (query?.format === "json") {
    return "json";
  }
  if (query?.format === "svg") {
    return "svg";
  }

  const accept = request.headers.accept ?? "";
  if (accept.includes("application/json") && !accept.includes("image/svg+xml")) {
    return "json";
  }
  return "svg";
}

function failureDetails(error: unknown): {
  attempts?: number;
  calls: LlmCallMetric[];
} {
  if (!isAppError(error) || !error.details || typeof error.details !== "object") {
    return { calls: [] };
  }
  const details = error.details as Record<string, unknown>;
  return {
    attempts:
      typeof details.attempts === "number" ? details.attempts : undefined,
    calls: Array.isArray(details.calls)
      ? (details.calls as LlmCallMetric[])
      : [],
  };
}

function buildMetrics(
  calls: LlmCallMetric[],
  latencyMs: number,
): ConversionMetrics {
  const usage = aggregateUsage(calls);
  return {
    latencyMs,
    upstreamLatencyMs: calls.reduce((total, call) => total + call.latencyMs, 0),
    promptTokens: usage?.promptTokens ?? 0,
    completionTokens: usage?.completionTokens ?? 0,
    totalTokens: usage?.totalTokens ?? 0,
    calls,
  };
}

function persistConversion(
  deps: VectorizeRouteDeps,
  request: FastifyRequest,
  entry: Parameters<ConversionStore["record"]>[0],
): void {
  try {
    deps.store.record(entry);
  } catch (error) {
    request.log.error({ err: error }, "failed to persist conversion");
  }
}

async function readImageBuffer(
  request: FastifyRequest,
  config: Config,
): Promise<Buffer> {
  if (request.isMultipart()) {
    let file;
    try {
      file = await request.file({
        limits: { fileSize: config.maxUploadBytes, files: 1 },
      });
    } catch (error) {
      if ((error as { code?: string }).code === "FST_REQ_FILE_TOO_LARGE") {
        throw new AppError(
          "payload_too_large",
          `Image exceeds the ${config.maxUploadBytes} byte limit`,
          413,
        );
      }
      throw error;
    }

    if (!file) {
      throw new AppError(
        "bad_request",
        "Missing multipart file field (expected 'image')",
        400,
      );

    }

    try {
      const buffer = await file.toBuffer();
      if (file.file.truncated) {
        throw new AppError(
          "payload_too_large",
          `Image exceeds the ${config.maxUploadBytes} byte limit`,
          413,
        );
      }
      return buffer;
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      if ((error as { code?: string }).code === "FST_REQ_FILE_TOO_LARGE") {
        throw new AppError(
          "payload_too_large",
          `Image exceeds the ${config.maxUploadBytes} byte limit`,
          413,
        );
      }
      throw error;
    }
  }

  const body = request.body as { image?: unknown } | undefined;
  if (!body || typeof body.image !== "string") {
    throw new AppError(
      "bad_request",
      "Expected a JSON body with an 'image' data URL or base64 string",
      400,
    );
  }
  return decodeImagePayload(body.image);
}

export async function registerVectorizeRoute(
  app: FastifyInstance,
  deps: VectorizeRouteDeps,
): Promise<void> {
  app.post(
    "/v1/vectorize",
    {
      schema: {
        tags: ["vectorize"],
        summary: "Convert an image to SVG",
        description:
          "Accepts a multipart file field named 'image' or a JSON body " +
          "`{ image: \"data:image/png;base64,...\" }`. Returns SVG by default; " +
          "use `?format=json` for metadata.",
        querystring: {
          type: "object",
          properties: {
            format: { type: "string", enum: ["svg", "json"] },
          },
        },
      },
    },
    async (request, reply) => {
      const startedAt = performance.now();
      const format = resolveFormat(request);
      const buffer = await readImageBuffer(request, deps.config);
      const image = await normalizeImage(buffer, {
        maxBytes: deps.config.maxUploadBytes,
        maxDimension: deps.config.maxImageDimension,
      });

      const input: ConversionInputImage = {
        mime: image.mime,
        width: image.width,
        height: image.height,
        bytes: image.bytes,
        originalWidth: image.originalWidth,
        originalHeight: image.originalHeight,
        originalBytes: buffer.length,
        downsampled: image.resized,
        data: image.data,
      };

      request.log.info(
        {
          requestId: request.id,
          downsampled: image.resized,
          from: `${image.originalWidth}x${image.originalHeight}`,
          to: `${image.width}x${image.height}`,
          scale: image.resized
            ? Number((image.width / image.originalWidth).toFixed(3))
            : 1,
          originalBytes: buffer.length,
          bytes: image.bytes,
          mime: image.mime,
        },
        image.resized ? "image downsampled" : "image not downsampled",
      );

      let result: VectorizeResult;
      try {
        if (deps.semaphore.pending >= deps.config.maxQueue) {
          throw new AppError(
            "rate_limited",
            "Too many queued requests; retry shortly",
            429,
          );
        }

        const release = await deps.semaphore.acquire();
        try {
          result = await vectorizeImage(deps, image, {
            requestId: request.id,
            logger: request.log,
          });
        } finally {
          release();
        }
      } catch (error) {
        const details = failureDetails(error);
        persistConversion(deps, request, {
          requestId: request.id,
          status: "error",
          model: null,
          promptId: deps.promptId,
          attempts: details.attempts ?? 0,
          input,
          output: null,
          metrics: buildMetrics(
            details.calls,
            Math.round(performance.now() - startedAt),
          ),
          error: {
            code: isAppError(error) ? error.code : "internal_error",
            message:
              error instanceof Error ? error.message : "Unknown error",
          },
        });
        throw error;
      }

      persistConversion(deps, request, {
        requestId: request.id,
        status: "success",
        model: result.model,
        promptId: deps.promptId,
        attempts: result.attempts,
        input,
        output: {
          svg: result.svg,
          bytes: result.stats.bytes,
          elements: result.stats.elements,
          paths: result.stats.paths,
          rig: result.rig,
          warnings: result.warnings,
        },
        metrics: buildMetrics(
          result.calls,
          Math.round(performance.now() - startedAt),
        ),
        error: null,
      });

      reply.header("x-request-id", request.id);
      reply.header("x-model", result.model);
      reply.header("x-prompt-version", result.promptVersion);
      reply.header("x-rig-nodes", String(result.stats.rigNodes));
      reply.header("x-rig-idle", String(result.stats.idleNodes));
      reply.header("x-content-type-options", "nosniff");
      reply.header("cache-control", "no-store");
      reply.header("vary", "Accept");
      reply.header(
        "content-security-policy",
        "default-src 'none'; style-src 'unsafe-inline'",
      );

      if (format === "json") {
        return reply.send({
          svg: result.svg,
          rig: result.rig,
          model: result.model,
          usage: result.usage,
          warnings: result.warnings,
          requestId: request.id,
          attempts: result.attempts,
          promptVersion: result.promptVersion,
        });
      }

      reply.type("image/svg+xml; charset=utf-8");
      reply.header("content-disposition", 'inline; filename="vector.svg"');
      return reply.send(result.svg);
    },
  );
}
