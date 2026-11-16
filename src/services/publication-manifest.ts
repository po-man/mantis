import { z } from "zod";

export const PUBLISH_RATINGS = ["nice", "fair", "bad"] as const;
export type PublishRating = (typeof PUBLISH_RATINGS)[number];

export const RATING_SECTIONS = [
  { rating: "nice", label: "Good", id: "good" },
  { rating: "fair", label: "Fair", id: "fair" },
  { rating: "bad", label: "Bad", id: "bad" },
] as const;

export const PUBLICATION_FORMAT = "vector.publication";
export const PUBLICATION_VERSION = 1;
export const PUBLICATION_BRAND = "Mantis";
export const PUBLICATION_TITLE = "Selected vector studies";
export const MAX_INTRO_WORDS = 99;

export const DEFAULT_PUBLICATION_INTRO =
  "Mantis is a small image-to-SVG service. You give it one photo of a " +
  "centered object; a vision model traces the subject into clean, layered " +
  "vector shapes, annotates depth, and the service derives a tiny parallax " +
  "rig. The result is a static SVG that also responds to a cursor or a " +
  "phone's tilt. These are selected outputs from our local evaluation runs, " +
  "grouped by our own quality ratings.";

export function countWords(value: string): number {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return 0;
  }
  return trimmed.split(/\s+/).length;
}

export function isSafeAssetPath(value: string): boolean {
  if (value.length === 0 || value.startsWith("/") || value.includes("\\")) {
    return false;
  }
  const segments = value.split("/");
  return segments.every(
    (segment) =>
      segment.length > 0 && segment !== "." && segment !== "..",
  );
}

const assetPath = z
  .string()
  .min(1)
  .refine(isSafeAssetPath, "must be a relative path without '..' segments");

const intro = z.string().superRefine((value, ctx) => {
  const words = countWords(value);
  if (words === 0) {
    ctx.addIssue({ code: "custom", message: "Intro cannot be empty" });
  } else if (words > MAX_INTRO_WORDS) {
    ctx.addIssue({
      code: "custom",
      message: `Intro must be less than 100 words (got ${words})`,
    });
  }
});

export const publicationItemSchema = z.object({
  id: z.number().int().positive(),
  rating: z.enum(PUBLISH_RATINGS),
  title: z.string().min(1),
  model: z.string().nullable(),
  promptVersion: z.string().min(1),
  createdAt: z.number().int().nonnegative(),
  inputWidth: z.number().int().positive().nullable().optional(),
  inputHeight: z.number().int().positive().nullable().optional(),
  assets: z.object({
    input: assetPath,
    svg: assetPath,
    rig: assetPath,
  }),
});

export const publicationFeaturedSchema = z.object({
  id: z.number().int().positive(),
  rating: z.enum(PUBLISH_RATINGS).nullable(),
  title: z.string().min(1),
  model: z.string().nullable(),
  promptVersion: z.string().min(1),
  createdAt: z.number().int().nonnegative(),
  assets: z.object({
    svg: assetPath,
    rig: assetPath,
  }),
});

export const publicationManifestSchema = z
  .object({
    format: z.literal(PUBLICATION_FORMAT),
    version: z.literal(PUBLICATION_VERSION),
    title: z.string().min(1),
    intro,
    generatedAt: z.string().min(1),
    items: z.array(publicationItemSchema),
    featured: publicationFeaturedSchema.nullable().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.items.length === 0 && !value.featured) {
      ctx.addIssue({
        code: "custom",
        message: "Publication must include at least one result",
      });
    }
    if (
      value.featured &&
      value.items.some((item) => item.id === value.featured?.id)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Featured conversion must not also appear in the galleries",
      });
    }
  });

export type PublicationItem = z.infer<typeof publicationItemSchema>;
export type PublicationFeatured = z.infer<typeof publicationFeaturedSchema>;
export type PublicationManifest = z.infer<typeof publicationManifestSchema>;

export function parsePublicationManifest(value: unknown): PublicationManifest {
  return publicationManifestSchema.parse(value);
}

export function ratingToSection(rating: PublishRating): {
  label: string;
  id: string;
} {
  const section = RATING_SECTIONS.find((entry) => entry.rating === rating);
  if (!section) {
    throw new Error(`Unknown rating: ${rating}`);
  }
  return { label: section.label, id: section.id };
}
