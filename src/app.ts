import { randomUUID } from "node:crypto";
import multipart from "@fastify/multipart";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import Fastify, { type FastifyInstance } from "fastify";
import { loadConfig, type Config } from "./config.js";
import { isAppError } from "./lib/errors.js";
import { loggerOptions } from "./lib/logger.js";
import { Semaphore } from "./lib/semaphore.js";
import { registerReviewRoutes } from "./routes/review.js";
import { registerVectorizeRoute } from "./routes/vectorize.js";
import { OpenRouterClient, type ChatClient } from "./services/openrouter.js";
import { loadPrompt, type PromptBundle } from "./services/prompt.js";
import { ConversionStore } from "./services/store.js";

export interface AppDeps {
  config: Config;
  prompt: PromptBundle;
  promptId: number;
  client: ChatClient;
  semaphore: Semaphore;
  store: ConversionStore;
}

export interface BuildAppOptions {
  config?: Config;
  prompt?: PromptBundle;
  client?: ChatClient;
  semaphore?: Semaphore;
  store?: ConversionStore;
  promptId?: number;
}

export async function buildApp(
  options: BuildAppOptions = {},
): Promise<FastifyInstance> {
  const config = options.config ?? loadConfig();
  const prompt =
    options.prompt ??
    (await loadPrompt(config.promptDir, config.promptVersion));
  const client = options.client ?? new OpenRouterClient(config);
  const semaphore =
    options.semaphore ?? new Semaphore(config.maxConcurrency);
  const store = options.store ?? new ConversionStore(config.databasePath);
  const promptId =
    options.promptId ??
    store.upsertPrompt({
      version: prompt.version,
      text: prompt.text,
      path: prompt.path,
    });

  const app = Fastify({
    genReqId: () => randomUUID(),
    logger: loggerOptions(config.logLevel),
    bodyLimit: Math.ceil(config.maxUploadBytes * 1.4),
    requestTimeout: config.requestTimeoutMs,
  });

  app.addHook("onClose", async () => {
    try {
      store.close();
    } catch {
      // The store may already be closed by the caller.
    }
  });

  await app.register(multipart, {
    limits: {
      fileSize: config.maxUploadBytes,
      files: 1,
      fields: 10,
    },
  });

  await app.register(swagger, {
    openapi: {
      info: {
        title: "vector",
        description:
          "Lightweight image-to-SVG microservice backed by OpenRouter.",
        version: "0.1.0",
      },
    },
  });
  await app.register(swaggerUi, { routePrefix: "/docs" });

  app.setErrorHandler((error, request, reply) => {
    if (isAppError(error)) {
      const logPayload = {
        code: error.code,
        statusCode: error.statusCode,
        message: error.message,
      };
      if (error.statusCode >= 500) {
        request.log.error(logPayload, "request failed");
      } else {
        request.log.warn(logPayload, "request failed");
      }
      return reply.status(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          requestId: request.id,
          ...(error.details === undefined ? {} : { details: error.details }),
        },
      });
    }

    const statusCode =
      typeof (error as { statusCode?: number }).statusCode === "number"
        ? (error as { statusCode: number }).statusCode
        : 500;
    const code = (error as { code?: string }).code;

    if (code === "FST_REQ_FILE_TOO_LARGE" || statusCode === 413) {
      return reply.status(413).send({
        error: {
          code: "payload_too_large",
          message: "Uploaded file is too large",
          requestId: request.id,
        },
      });
    }

    if (statusCode === 415) {
      return reply.status(415).send({
        error: {
          code: "unsupported_media_type",
          message:
            error instanceof Error
              ? error.message
              : "Unsupported media type",
          requestId: request.id,
        },
      });
    }

    if (statusCode >= 400 && statusCode < 500) {
      return reply.status(statusCode).send({
        error: {
          code: "bad_request",
          message:
            error instanceof Error ? error.message : "Bad request",
          requestId: request.id,
        },
      });
    }

    request.log.error({ err: error }, "unhandled error");
    return reply.status(500).send({
      error: {
        code: "internal_error",
        message: "Internal server error",
        requestId: request.id,
      },
    });
  });

  app.setNotFoundHandler((request, reply) => {
    return reply.status(404).send({
      error: {
        code: "not_found",
        message: `Route ${request.method} ${request.url} not found`,
        requestId: request.id,
      },
    });
  });

  app.get(
    "/healthz",
    { schema: { tags: ["ops"], summary: "Liveness probe" } },
    async () => ({ status: "ok" }),
  );

  app.get(
    "/readyz",
    { schema: { tags: ["ops"], summary: "Readiness probe" } },
    async () => ({
      status: "ok",
      model: config.openrouterModel,
      promptVersion: prompt.version,
    }),
  );

  await registerVectorizeRoute(app, {
    config,
    prompt,
    promptId,
    client,
    semaphore,
    store,
  });

  if (config.reviewUiEnabled) {
    await registerReviewRoutes(app, {
      store,
      publishDir: config.publishDir,
      publishEnabled: config.publishEnabled,
      publishInputDimension: config.publishInputDimension,
    });
  }

  return app;
}
