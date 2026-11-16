import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { AppError } from "../lib/errors.js";
import { deriveParallaxRig } from "./parallax.js";
import {
  DEFAULT_PUBLICATION_INTRO,
  MAX_INTRO_WORDS,
  PUBLICATION_FORMAT,
  PUBLICATION_TITLE,
  PUBLICATION_VERSION,
  countWords,
  parsePublicationManifest,
  type PublicationItem,
  type PublicationManifest,
} from "./publication-manifest.js";
import type { ConversionStore, SelectionCounts } from "./store.js";

export interface CreatePublicationOptions {
  store: ConversionStore;
  outDir: string;
  intro?: string;
  title?: string;
  generatedAt?: Date;
}

export interface PublicationBundleResult {
  manifestPath: string;
  assetsDir: string;
  manifest: PublicationManifest;
  counts: SelectionCounts;
  introWords: number;
}

function inputExtension(mime: string): string {
  switch (mime) {
    case "image/png":
      return "png";
    case "image/jpeg":
      return "jpg";
    case "image/webp":
      return "webp";
    default:
      throw new AppError(
        "bad_request",
        `Cannot publish an input image with MIME type ${mime}`,
        400,
      );
  }
}

function assetBase(index: number, id: number): string {
  return `${String(index + 1).padStart(4, "0")}-${id}`;
}

export async function createPublicationBundle(
  options: CreatePublicationOptions,
): Promise<PublicationBundleResult> {
  const intro = options.intro ?? DEFAULT_PUBLICATION_INTRO;
  const title = options.title ?? PUBLICATION_TITLE;
  const introWords = countWords(intro);

  if (introWords === 0) {
    throw new AppError("bad_request", "The publication intro cannot be empty", 400);
  }
  if (introWords > MAX_INTRO_WORDS) {
    throw new AppError(
      "bad_request",
      `The publication intro must be less than 100 words (got ${introWords})`,
      400,
    );
  }

  const selected = options.store.listSelected();
  if (selected.length === 0) {
    throw new AppError(
      "bad_request",
      "Select at least one conversion before publishing",
      400,
    );
  }

  const outDir = path.resolve(options.outDir);
  const assetsDir = path.join(outDir, "assets");
  await rm(assetsDir, { recursive: true, force: true });
  await mkdir(assetsDir, { recursive: true });

  const items: PublicationItem[] = [];
  for (const [index, conversion] of selected.entries()) {
    if (conversion.status !== "success" || !conversion.rating) {
      throw new AppError(
        "bad_request",
        `Conversion ${conversion.id} cannot be published`,
        400,
      );
    }

    const input = options.store.getInput(conversion.id);
    if (!input) {
      throw new AppError(
        "bad_request",
        `Conversion ${conversion.id} has no stored input image`,
        400,
      );
    }

    const storedSvg = options.store.getOutput(conversion.id);
    if (!storedSvg) {
      throw new AppError(
        "bad_request",
        `Conversion ${conversion.id} has no stored SVG output`,
        400,
      );
    }

    const detail = options.store.get(conversion.id);
    let svg = storedSvg;
    let rig = detail?.rig ?? null;
    if (!rig) {
      try {
        const derived = deriveParallaxRig(storedSvg);
        svg = derived.svg;
        rig = derived.rig;
      } catch (error) {
        throw new AppError(
          "bad_request",
          `Conversion ${conversion.id} has no usable parallax rig: ` +
            (error instanceof Error ? error.message : String(error)),
          400,
        );
      }
    }

    const base = assetBase(index, conversion.id);
    const inputName = `${base}-input.${inputExtension(input.mime)}`;
    const svgName = `${base}.svg`;
    const rigName = `${base}.rig.json`;

    await writeFile(path.join(assetsDir, inputName), input.data);
    await writeFile(path.join(assetsDir, svgName), svg, "utf8");
    await writeFile(
      path.join(assetsDir, rigName),
      `${JSON.stringify(rig, null, 2)}\n`,
      "utf8",
    );

    items.push({
      id: conversion.id,
      rating: conversion.rating,
      title: `Conversion #${conversion.id}`,
      model: conversion.model,
      promptVersion: conversion.promptVersion,
      createdAt: conversion.createdAt,
      inputWidth: conversion.inputWidth,
      inputHeight: conversion.inputHeight,
      assets: {
        input: path.posix.join("assets", inputName),
        svg: path.posix.join("assets", svgName),
        rig: path.posix.join("assets", rigName),
      },
    });
  }

  const manifest = parsePublicationManifest({
    format: PUBLICATION_FORMAT,
    version: PUBLICATION_VERSION,
    title,
    intro,
    generatedAt: (options.generatedAt ?? new Date()).toISOString(),
    items,
  });

  const manifestPath = path.join(outDir, "selections.json");
  const temporaryPath = `${manifestPath}.tmp`;
  await writeFile(
    temporaryPath,
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
  await rename(temporaryPath, manifestPath);

  return {
    manifestPath,
    assetsDir,
    manifest,
    counts: options.store.selectionCounts(),
    introWords,
  };
}
