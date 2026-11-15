import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { AppError } from "../lib/errors.js";
import type { ConversionStore } from "../services/store.js";

export interface ReviewRouteDeps {
  store: ConversionStore;
}

const REVIEW_HTML_PATH = fileURLToPath(
  new URL("../../public/review.html", import.meta.url),
);

let cachedHtml: string | undefined;

async function reviewHtml(): Promise<string> {
  if (cachedHtml === undefined) {
    cachedHtml = await readFile(REVIEW_HTML_PATH, "utf8");
  }
  return cachedHtml;
}

function parseId(request: FastifyRequest): number {
  const params = request.params as { id?: string };
  const id = Number(params.id);
  if (!Number.isInteger(id) || id < 1) {
    throw new AppError("bad_request", "Invalid conversion id", 400);
  }
  return id;
}

function optionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function optionalNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function registerReviewRoutes(
  app: FastifyInstance,
  deps: ReviewRouteDeps,
): Promise<void> {
  app.get(
    "/review",
    { schema: { tags: ["review"], summary: "Conversion review UI" } },
    async (_request, reply) => {
      reply.header("cache-control", "no-store");
      reply.header(
        "content-security-policy",
        "default-src 'self'; img-src 'self' data:; style-src 'unsafe-inline'; " +
          "script-src 'unsafe-inline'; connect-src 'self'; object-src 'none'; " +
          "base-uri 'none'; frame-ancestors 'none'",
      );
      reply.type("text/html; charset=utf-8");
      return reply.send(await reviewHtml());
    },
  );

  app.get(
    "/review/api/conversions",
    {
      schema: {
        tags: ["review"],
        summary: "List recorded conversions",
      },
    },
    async (request, reply) => {
      const query = request.query as Record<string, unknown>;
      const status =
        query.status === "success" || query.status === "error"
          ? query.status
          : undefined;

      reply.header("cache-control", "no-store");
      return reply.send(
        deps.store.list({
          limit: optionalNumber(query.limit, 25),
          offset: optionalNumber(query.offset, 0),
          status,
          model: optionalString(query.model),
          promptVersion: optionalString(query.promptVersion),
          q: optionalString(query.q),
        }),
      );
    },
  );

  app.get(
    "/review/api/stats",
    { schema: { tags: ["review"], summary: "Conversion statistics" } },
    async (_request, reply) => {
      reply.header("cache-control", "no-store");
      return reply.send(deps.store.stats());
    },
  );

  app.get(
    "/review/api/conversions/:id",
    { schema: { tags: ["review"], summary: "Conversion detail" } },
    async (request, reply) => {
      const detail = deps.store.get(parseId(request));
      if (!detail) {
        throw new AppError("not_found", "Conversion not found", 404);
      }
      reply.header("cache-control", "no-store");
      return reply.send(detail);
    },
  );

  app.get(
    "/review/api/conversions/:id/input",
    { schema: { tags: ["review"], summary: "Stored input image" } },
    async (request, reply) => {
      const input = deps.store.getInput(parseId(request));
      if (!input) {
        throw new AppError("not_found", "Input image not found", 404);
      }
      reply.header("cache-control", "no-store");
      reply.header("x-content-type-options", "nosniff");
      reply.type(input.mime);
      return reply.send(input.data);
    },
  );

  app.get(
    "/review/api/conversions/:id/output.svg",
    { schema: { tags: ["review"], summary: "Stored SVG output" } },
    async (request, reply) => {
      const svg = deps.store.getOutput(parseId(request));
      if (!svg) {
        throw new AppError("not_found", "SVG output not found", 404);
      }
      reply.header("cache-control", "no-store");
      reply.header("x-content-type-options", "nosniff");
      reply.header(
        "content-security-policy",
        "default-src 'none'; style-src 'unsafe-inline'",
      );
      reply.type("image/svg+xml; charset=utf-8");
      return reply.send(svg);
    },
  );
}
