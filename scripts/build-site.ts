import { cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseSvg } from "../src/services/svg-parser.js";
import {
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

function assetCounts(
  manifest: PublicationManifest,
): Record<PublishRating, number> {
  const counts: Record<PublishRating, number> = { nice: 0, fair: 0, bad: 0 };
  for (const item of manifest.items) {
    counts[item.rating] += 1;
  }
  return counts;
}

function shortCommit(): string | null {
  const value =
    process.env.GITHUB_ACTIONS === "true"
      ? process.env.GITHUB_SHA
      : undefined;
  return value ? value.slice(0, 7) : null;
}

function buildMeta(manifest: PublicationManifest): string {
  const tag =
    process.env.GITHUB_ACTIONS === "true"
      ? process.env.GITHUB_REF_NAME
      : undefined;
  const commit = shortCommit();
  const parts = [
    `${manifest.items.length} selected result${manifest.items.length === 1 ? "" : "s"}`,
    `generated ${escapeHtml(manifest.generatedAt)}`,
  ];
  if (tag) {
    parts.push(`tag <code>${escapeHtml(tag)}</code>`);
  } else {
    parts.push("local build");
  }
  if (commit) {
    parts.push(`commit <code>${escapeHtml(commit)}</code>`);
  }
  return parts.join(" · ");
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
        throw new Error(
          `Missing ${kind} asset for conversion ${item.id}: ${assetPath}`,
        );
      }
      if (!info.isFile() || info.size === 0) {
        throw new Error(
          `Empty ${kind} asset for conversion ${item.id}: ${assetPath}`,
        );
      }

      if (kind === "svg") {
        const svg = await readFile(absolute, "utf8");
        try {
          parseSvg(svg);
        } catch (error) {
          throw new Error(
            `Invalid SVG for conversion ${item.id}: ` +
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
          throw new Error(`Invalid parallax rig for conversion ${item.id}`);
        }
      }

      assets.set(assetPath, absolute);
    }
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
  html = replaceSlot(html, "<!--TITLE-->", escapeHtml(manifest.title));
  html = replaceSlot(
    html,
    "<!--DESCRIPTION-->",
    escapeHtml(description(manifest.intro)),
  );
  html = replaceSlot(html, "<!--INTRO-->", introHtml(manifest.intro));
  html = replaceSlot(html, "<!--SECTIONS-->", sectionsHtml(manifest));
  html = replaceSlot(html, "<!--BUILD_META-->", buildMeta(manifest));

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
