import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { AppError } from "../lib/errors.js";
import { deriveParallaxRig } from "../services/parallax.js";
import { createPublicationBundle } from "../services/publication.js";
import {
  DEFAULT_PUBLICATION_INTRO,
  MAX_INTRO_WORDS,
  PUBLICATION_TITLE,
  PUBLISH_RATINGS,
  parsePublicationManifest,
  type PublishRating,
} from "../services/publication-manifest.js";
import type { ConversionStore } from "../services/store.js";

export interface ReviewRouteDeps {
  store: ConversionStore;
  publishDir: string;
  publishEnabled: boolean;
  /** Longest side of the downsampled input thumbnails written when publishing. */
  publishInputDimension: number;
}

const REVIEW_HTML_PATH = fileURLToPath(
  new URL("../../public/review.html", import.meta.url),
);
const PARALLAX_PLAYER_PATH = fileURLToPath(
  new URL("../../public/parallax-player.js", import.meta.url),
);

let cachedHtml: string | undefined;
let cachedPlayer: string | undefined;

async function reviewHtml(): Promise<string> {
  if (cachedHtml === undefined) {
    cachedHtml = await readFile(REVIEW_HTML_PATH, "utf8");
  }
  return cachedHtml;
}

async function parallaxPlayerJs(): Promise<string> {
  if (cachedPlayer === undefined) {
    cachedPlayer = await readFile(PARALLAX_PLAYER_PATH, "utf8");
  }
  return cachedPlayer;
}

function isPublishRating(value: unknown): value is PublishRating {
  return (
    typeof value === "string" &&
    (PUBLISH_RATINGS as readonly string[]).includes(value)
  );
}

function assertSameOrigin(request: FastifyRequest): void {
  const origin = request.headers.origin;
  if (!origin) {
    return;
  }
  const host = request.headers.host;
  try {
    if (!host || new URL(origin).host !== host) {
      throw new Error("origin mismatch");
    }
  } catch {
    throw new AppError("forbidden", "Cross-origin publication writes are not allowed", 403);
  }
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
          "script-src 'self' 'unsafe-inline'; connect-src 'self'; " +
          "object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
      );
      reply.type("text/html; charset=utf-8");
      return reply.send(await reviewHtml());
    },
  );

  app.get(
    "/review/parallax-player.js",
    { schema: { tags: ["review"], summary: "Shared parallax player" } },
    async (_request, reply) => {
      reply.header("cache-control", "no-store");
      reply.header("x-content-type-options", "nosniff");
      reply.type("text/javascript; charset=utf-8");
      return reply.send(await parallaxPlayerJs());
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
      const rating =
        query.rating === "nice" ||
        query.rating === "fair" ||
        query.rating === "bad" ||
        query.rating === "unrated"
          ? query.rating
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
          rating,
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

  if (deps.publishEnabled) {
    app.get(
      "/review/api/publication",
      {
        schema: {
          tags: ["review"],
          summary: "Local publication staging metadata",
        },
      },
      async (_request, reply) => {
        const publishDir = path.resolve(deps.publishDir);
        const manifestPath = path.join(publishDir, "selections.json");
        const counts = deps.store.selectionCounts();
        const featuredId = deps.store.getFeaturedId();
        const featuredDetail =
          featuredId === null ? null : deps.store.get(featuredId);
        const featured = featuredDetail
          ? {
              id: featuredDetail.id,
              title: `Conversion #${featuredDetail.id}`,
              rating: featuredDetail.rating,
            }
          : null;
        let exists = false;
        let intro = DEFAULT_PUBLICATION_INTRO;
        let title = PUBLICATION_TITLE;
        let generatedAt: string | null = null;
        let manifestError: string | null = null;

        try {
          const parsed = parsePublicationManifest(
            JSON.parse(await readFile(manifestPath, "utf8")),
          );
          exists = true;
          intro = parsed.intro;
          title = parsed.title;
          generatedAt = parsed.generatedAt;
        } catch (error) {
          if ((error as { code?: string }).code !== "ENOENT") {
            manifestError =
              error instanceof Error ? error.message : String(error);
          }
        }

        reply.header("cache-control", "no-store");
        return reply.send({
          title,
          defaultIntro: DEFAULT_PUBLICATION_INTRO,
          intro,
          exists,
          generatedAt,
          manifestError,
          counts,
          featured,
          publishDir: path.relative(process.cwd(), publishDir) || ".",
          maxIntroWords: MAX_INTRO_WORDS,
        });
      },
    );

    app.put(
      "/review/api/publication/featured",
      {
        schema: {
          tags: ["review"],
          summary: "Set or clear the single featured publication conversion",
        },
      },
      async (request, reply) => {
        assertSameOrigin(request);
        const body = request.body as { conversionId?: unknown } | undefined;
        if (!body || !("conversionId" in body)) {
          throw new AppError(
            "bad_request",
            "Expected a JSON body with a conversionId",
            400,
          );
        }

        const value = body.conversionId;
        if (value === null) {
          deps.store.setFeatured(null);
          reply.header("cache-control", "no-store");
          return reply.send({ conversionId: null });
        }

        if (
          typeof value !== "number" ||
          !Number.isInteger(value) ||
          value < 1
        ) {
          throw new AppError("bad_request", "Invalid conversion id", 400);
        }

        const detail = deps.store.get(value);
        if (!detail) {
          throw new AppError("not_found", "Conversion not found", 404);
        }
        if (detail.status !== "success") {
          throw new AppError(
            "bad_request",
            "Only successful conversions can be featured",
            400,
          );
        }

        deps.store.setFeatured(value);
        reply.header("cache-control", "no-store");
        return reply.send({ conversionId: value });
      },
    );

    app.post(
      "/review/api/publish",
      {
        schema: {
          tags: ["review"],
          summary: "Write the local publication staging bundle",
        },
      },
      async (request, reply) => {
        assertSameOrigin(request);
        const body = request.body as
          | { intro?: unknown; title?: unknown }
          | undefined;
        const intro =
          body?.intro === undefined
            ? undefined
            : typeof body.intro === "string"
              ? body.intro
              : (() => {
                  throw new AppError("bad_request", "Intro must be a string", 400);
                })();
        const title =
          body?.title === undefined
            ? undefined
            : typeof body.title === "string"
              ? body.title
              : (() => {
                  throw new AppError("bad_request", "Title must be a string", 400);
                })();

        const result = await createPublicationBundle({
          store: deps.store,
          outDir: deps.publishDir,
          intro,
          title,
          inputMaxDimension: deps.publishInputDimension,
        });

        for (const warning of result.warnings) {
          request.log.warn({ publish: true }, warning);
        }

        reply.header("cache-control", "no-store");
        return reply.send({
          manifestPath:
            path.relative(process.cwd(), result.manifestPath) ||
            result.manifestPath,
          assetsDir:
            path.relative(process.cwd(), result.assetsDir) || result.assetsDir,
          counts: result.counts,
          introWords: result.introWords,
          itemCount: result.manifest.items.length,
          featuredId: result.featured?.id ?? null,
          warnings: result.warnings,
        });
      },
    );
  }

  app.get(
    "/review/api/conversions/:id",
    { schema: { tags: ["review"], summary: "Conversion detail" } },
    async (request, reply) => {
      const id = parseId(request);
      let detail = deps.store.get(id);
      if (!detail) {
        throw new AppError("not_found", "Conversion not found", 404);
      }

      // Old records predate stored rigs; derive one from the stored SVG so the
      // review UI can demonstrate the interaction on historical conversions.
      if (!detail.rig && detail.status === "success") {
        const svg = deps.store.getOutput(id);
        if (svg) {
          try {
            const rig = deriveParallaxRig(svg).rig;
            detail = {
              ...detail,
              rig,
              hasRig: true,
              rigNodes: rig.nodes.length,
            };
          } catch {
            // A malformed historical SVG simply has no interactive preview.
          }
        }
      }

      reply.header("cache-control", "no-store");
      return reply.send(detail);
    },
  );

  app.put(
    "/review/api/conversions/:id/selection",
    {
      schema: {
        tags: ["review"],
        summary: "Set or clear a publication rating for a conversion",
      },
    },
    async (request, reply) => {
      assertSameOrigin(request);
      const id = parseId(request);
      const detail = deps.store.get(id);
      if (!detail) {
        throw new AppError("not_found", "Conversion not found", 404);
      }
      if (detail.status !== "success") {
        throw new AppError(
          "bad_request",
          "Only successful conversions can be rated for publication",
          400,
        );
      }

      const body = request.body as { rating?: unknown } | undefined;
      const rating = body?.rating;
      if (rating !== null && rating !== undefined && !isPublishRating(rating)) {
        throw new AppError(
          "bad_request",
          "Rating must be 'nice', 'fair', 'bad', or null",
          400,
        );
      }

      const saved =
        rating === null || rating === undefined
          ? null
          : (rating as PublishRating);
      const result = deps.store.setSelection(id, saved);
      reply.header("cache-control", "no-store");
      return reply.send({ id, rating: result });
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

  app.get(
    "/review/api/conversions/:id/parallax.svg",
    {
      schema: {
        tags: ["review"],
        summary: "SVG output normalized for the parallax rig",
      },
    },
    async (request, reply) => {
      const id = parseId(request);
      const svg = deps.store.getOutput(id);
      if (!svg) {
        throw new AppError("not_found", "SVG output not found", 404);
      }

      // Newer records store the already-normalized SVG. Historical records are
      // normalized on demand so the rig's injected ids and clip wrappers exist.
      const normalized = deps.store.getRig(id)
        ? svg
        : deriveParallaxRig(svg).svg;

      reply.header("cache-control", "no-store");
      reply.header("x-content-type-options", "nosniff");
      reply.header(
        "content-security-policy",
        "default-src 'none'; style-src 'unsafe-inline'",
      );
      reply.type("image/svg+xml; charset=utf-8");
      return reply.send(normalized);
    },
  );

  app.get(
    "/review/api/conversions/:id/rig.json",
    { schema: { tags: ["review"], summary: "Parallax rig for a conversion" } },
    async (request, reply) => {
      const id = parseId(request);
      const stored = deps.store.getRig(id);
      if (stored) {
        reply.header("cache-control", "no-store");
        return reply.send(stored);
      }

      const svg = deps.store.getOutput(id);
      if (!svg) {
        throw new AppError("not_found", "SVG output not found", 404);
      }

      reply.header("cache-control", "no-store");
      return reply.send(deriveParallaxRig(svg).rig);
    },
  );
}
