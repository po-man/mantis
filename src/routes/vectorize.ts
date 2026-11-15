import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Config } from "../config.js";
import { AppError } from "../lib/errors.js";
import type { Semaphore } from "../lib/semaphore.js";
import { truncate } from "../lib/text.js";
import { decodeImagePayload, normalizeImage } from "../services/image.js";
import type { ChatClient } from "../services/openrouter.js";
import type { PromptBundle } from "../services/prompt.js";
import { vectorizeImage } from "../services/vectorize.js";

export interface VectorizeRouteDeps {
  config: Config;
  prompt: PromptBundle;
  client: ChatClient;
  semaphore: Semaphore;
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
      const format = resolveFormat(request);
      const buffer = await readImageBuffer(request, deps.config);
      const image = await normalizeImage(buffer, {
        maxBytes: deps.config.maxUploadBytes,
        maxDimension: deps.config.maxImageDimension,
      });

      if (deps.semaphore.pending >= deps.config.maxQueue) {
        throw new AppError(
          "rate_limited",
          "Too many queued requests; retry shortly",
          429,
        );
      }

      const release = await deps.semaphore.acquire();
      let result;
      try {
        result = await vectorizeImage(deps, image);
      } finally {
        release();
      }

      reply.header("x-request-id", request.id);
      reply.header("x-model", result.model);
      reply.header("x-prompt-version", result.promptVersion);
      reply.header("x-content-type-options", "nosniff");
      reply.header("cache-control", "no-store");
      reply.header("vary", "Accept");
      reply.header(
        "content-security-policy",
        "default-src 'none'; style-src 'unsafe-inline'",
      );

      if (result.warnings.length > 0) {
        reply.header(
          "x-svg-warnings",
          truncate(result.warnings.join("; "), 1000),
        );
      }

      if (format === "json") {
        return reply.send({
          svg: result.svg,
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
