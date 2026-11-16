import { cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseSvg } from "../src/services/svg-parser.js";
import {
  PUBLICATION_BRAND,
  RATING_SECTIONS,
  parsePublicationManifest,
  type PublicationItem,
  type PublicationManifest,
  type PublishRating,
} from "../src/services/publication-manifest.js";

export interface BuildSiteOptions {
  rootDir?: string;
  manifestPath?: string;
  outDir?: string;
  check?: boolean;
  builtAt?: Date;
}

export interface BuildSiteResult {
  outDir: string;
  manifestPath: string;
  itemCount: number;
  counts: Record<PublishRating, number>;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function replaceSlot(template: string, slot: string, value: string): string {
  return template.replaceAll(slot, () => value);
}

function introHtml(intro: string): string {
  return intro
    .trim()
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`)
    .join("\n        ");
}

function description(intro: string): string {
  const compact = intro.replace(/\s+/g, " ").trim();
  return compact.length > 160 ? `${compact.slice(0, 157)}…` : compact;
}

function cardHtml(item: PublicationItem, index: number): string {
  const input = `./${item.assets.input}`;
  const svg = `./${item.assets.svg}`;
  const title = escapeHtml(item.title);
  return (
    `<button class="result" type="button" data-index="${index}" data-rating="${item.rating}" aria-label="Open interactive view of ${title}">` +
    '<span class="pair">' +
    `<span class="shot"><img src="${escapeHtml(input)}" alt="${title} input image" loading="lazy" decoding="async" /><span class="cap">Input</span></span>` +
    `<span class="shot"><img src="${escapeHtml(svg)}" alt="${title} SVG" loading="lazy" decoding="async" /><span class="cap">SVG</span></span>` +
    "</span>" +
    "</button>"
  );
}

function sectionsHtml(manifest: PublicationManifest): string {
  const indexById = new Map(
    manifest.items.map((item, index) => [item.id, index] as const),
  );
  return RATING_SECTIONS.map((section) => {
    const items = manifest.items.filter(
      (item) => item.rating === section.rating,
    );
    const body =
      items.length === 0
        ? '<p class="empty">No results in this tier.</p>'
        : `<div class="gallery">${items
            .map((item) => cardHtml(item, indexById.get(item.id) ?? 0))
            .join("\n")}</div>`;
    return (
      `<section class="rating-section" id="${section.id}">` +
      `<h2>${section.label} <span class="count">${items.length}</span></h2>` +
      body +
      "</section>"
    );
  }).join("\n      ");
}

function featuredHtml(manifest: PublicationManifest): string {
  if (!manifest.featured) {
    return "";
  }
  const src = escapeHtml(`./${manifest.featured.assets.svg}`);
  return (
    '<div class="hero-feature">' +
    '<div class="feature-stage" id="featured-stage" aria-label="Featured vector sample">' +
    `<img src="${src}" alt="Featured vector sample" />` +
    "</div>" +
    "</div>"
  );
}

function heroHtml(manifest: PublicationManifest): string {
  return (
    `<div class="hero${manifest.featured ? " has-feature" : ""}">` +
    '<div class="hero-copy">' +
    `<p class="eyebrow">${escapeHtml(PUBLICATION_BRAND)}</p>` +
    `<h1>${escapeHtml(manifest.title)}</h1>` +
    `<div class="intro">${introHtml(manifest.intro)}</div>` +
    "</div>" +
    featuredHtml(manifest) +
    "</div>"
  );
}

function assetCounts(
  manifest: PublicationManifest,
): Record<PublishRating, number> {
  const counts: Record<PublishRating, number> = { nice: 0, fair: 0, bad: 0 };
  for (const item of manifest.items) {
    counts[item.rating] += 1;
  }
  return counts;
}

function repositoryUrl(): string {
  const override = process.env.PUBLICATION_REPO_URL?.trim();
  if (override) {
    return override;
  }
  const repository = process.env.GITHUB_REPOSITORY?.trim();
  if (repository) {
    return `https://github.com/${repository}`;
  }
  return "https://github.com/po-man/mantis";
}

function formatPublishedAt(value: Date): string {
  return (
    new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "UTC",
    }).format(value) + " UTC"
  );
}

function buildMeta(builtAt: Date): string {
  return (
    'Last published at <time datetime="' +
    escapeHtml(builtAt.toISOString()) +
    '">' +
    escapeHtml(formatPublishedAt(builtAt)) +
    "</time> · " +
    '<a href="' +
    escapeHtml(repositoryUrl()) +
    '" target="_blank" rel="noreferrer">GitHub repository</a>'
  );
}

function documentTitle(title: string): string {
  return title.startsWith(PUBLICATION_BRAND)
    ? title
    : `${PUBLICATION_BRAND} · ${title}`;
}

async function validateAsset(
  manifestDir: string,
  assetPath: string,
  kind: string,
  id: number,
  assets: Map<string, string>,
): Promise<void> {
  if (assets.has(assetPath)) {
    throw new Error(`Asset path is reused: ${assetPath}`);
  }
  const absolute = path.resolve(manifestDir, assetPath);
  const relative = path.relative(manifestDir, absolute);
  if (
    relative.startsWith("..") ||
    path.isAbsolute(relative) ||
    relative.length === 0
  ) {
    throw new Error(`Asset escapes the publication directory: ${assetPath}`);
  }

  let info;
  try {
    info = await stat(absolute);
  } catch {
    throw new Error(`Missing ${kind} asset for conversion ${id}: ${assetPath}`);
  }
  if (!info.isFile() || info.size === 0) {
    throw new Error(`Empty ${kind} asset for conversion ${id}: ${assetPath}`);
  }

  if (kind === "svg") {
    const svg = await readFile(absolute, "utf8");
    try {
      parseSvg(svg);
    } catch (error) {
      throw new Error(
        `Invalid SVG for conversion ${id}: ` +
          (error instanceof Error ? error.message : String(error)),
      );
    }
  }

  if (kind === "rig") {
    const rig = JSON.parse(await readFile(absolute, "utf8")) as {
      format?: unknown;
      nodes?: unknown;
      viewBox?: unknown;
      anchors?: unknown;
    };
    if (
      rig.format !== "vector.parallax" ||
      !Array.isArray(rig.nodes) ||
      !Array.isArray(rig.viewBox) ||
      rig.viewBox.length !== 4
    ) {
      throw new Error(`Invalid parallax rig for conversion ${id}`);
    }
  }

  assets.set(assetPath, absolute);
}

async function validateAssets(
  manifestPath: string,
  manifest: PublicationManifest,
): Promise<Map<string, string>> {
  const manifestDir = path.dirname(manifestPath);
  const seen = new Set<number>();
  const assets = new Map<string, string>();

  for (const item of manifest.items) {
    if (seen.has(item.id)) {
      throw new Error(`Duplicate conversion id ${item.id}`);
    }
    seen.add(item.id);

    for (const [kind, assetPath] of Object.entries(item.assets)) {
      await validateAsset(manifestDir, assetPath, kind, item.id, assets);
    }
  }

  if (manifest.featured) {
    if (seen.has(manifest.featured.id)) {
      throw new Error(
        `Featured conversion ${manifest.featured.id} also appears in the galleries`,
      );
    }
    await validateAsset(
      manifestDir,
      manifest.featured.assets.svg,
      "svg",
      manifest.featured.id,
      assets,
    );
    await validateAsset(
      manifestDir,
      manifest.featured.assets.rig,
      "rig",
      manifest.featured.id,
      assets,
    );
  }

  return assets;
}

export async function buildSite(
  options: BuildSiteOptions = {},
): Promise<BuildSiteResult> {
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const manifestPath = path.resolve(
    rootDir,
    options.manifestPath ?? path.join("publish", "selections.json"),
  );
  const outDir = path.resolve(rootDir, options.outDir ?? "site");

  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch (error) {
    throw new Error(
      `Could not read ${path.relative(rootDir, manifestPath)}: ` +
        (error instanceof Error ? error.message : String(error)),
    );
  }

  let manifest: PublicationManifest;
  try {
    manifest = parsePublicationManifest(raw);
  } catch (error) {
    throw new Error(
      `Invalid publication manifest: ` +
        (error instanceof Error ? error.message : String(error)),
    );
  }

  const assets = await validateAssets(manifestPath, manifest);
  const counts = assetCounts(manifest);
  const builtAt = options.builtAt ?? new Date();

  if (options.check) {
    return { outDir, manifestPath, itemCount: manifest.items.length, counts };
  }

  const template = await readFile(
    path.join(rootDir, "public", "publish-site.html"),
    "utf8",
  );

  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  for (const [assetPath, absolute] of assets) {
    const target = path.resolve(outDir, assetPath);
    await mkdir(path.dirname(target), { recursive: true });
    await cp(absolute, target);
  }

  for (const file of ["publish.css", "publish.js", "parallax-player.js"]) {
    await cp(path.join(rootDir, "public", file), path.join(outDir, file));
  }

  let html = template;
  html = replaceSlot(
    html,
    "<!--TITLE-->",
    escapeHtml(documentTitle(manifest.title)),
  );
  html = replaceSlot(
    html,
    "<!--DESCRIPTION-->",
    escapeHtml(description(manifest.intro)),
  );
  html = replaceSlot(html, "<!--HERO-->", heroHtml(manifest));
  html = replaceSlot(html, "<!--SECTIONS-->", sectionsHtml(manifest));
  html = replaceSlot(html, "<!--BUILD_META-->", buildMeta(builtAt));

  await writeFile(path.join(outDir, "index.html"), html, "utf8");
  await writeFile(
    path.join(outDir, "publication.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
  await writeFile(path.join(outDir, ".nojekyll"), "", "utf8");

  return { outDir, manifestPath, itemCount: manifest.items.length, counts };
}

function parseArgs(argv: string[]): BuildSiteOptions {
  const options: BuildSiteOptions = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      const value = argv[index + 1];
      if (!value) throw new Error(`${arg} requires a value`);
      index += 1;
      return value;
    };
    switch (arg) {
      case "--manifest":
        options.manifestPath = next();
        break;
      case "--out":
        options.outDir = next();
        break;
      case "--root":
        options.rootDir = next();
        break;
      case "--check":
        options.check = true;
        break;
      case "--help":
      case "-h":
        console.log(
          "Usage: tsx scripts/build-site.ts [--manifest publish/selections.json] " +
            "[--out site] [--check]",
        );
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }
  return options;
}

const isMain =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMain) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const result = await buildSite(options);
    if (options.check) {
      console.log(
        `Publication manifest is valid: ${result.itemCount} items ` +
          `(${result.counts.nice} good, ${result.counts.fair} fair, ${result.counts.bad} bad)`,
      );
    } else {
      console.log(
        `Built ${path.relative(process.cwd(), result.outDir)} from ` +
          `${path.relative(process.cwd(), result.manifestPath)}: ` +
          `${result.itemCount} items (${result.counts.nice} good, ` +
          `${result.counts.fair} fair, ${result.counts.bad} bad)`,
      );
    }
  } catch (error) {
    console.error(
      `error: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}
