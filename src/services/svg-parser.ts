import { load, type CheerioAPI } from "cheerio";
import { SaxesParser } from "saxes";

const SVG_NS = "http://www.w3.org/2000/svg";
const CANONICAL_VIEWBOX = "0 0 1024 1024";

const DRAWABLE_TAGS = new Set([
  "path",
  "rect",
  "circle",
  "ellipse",
  "polygon",
  "polyline",
  "line",
  "text",
  "use",
]);

const FORBIDDEN_TAGS = new Set([
  "script",
  "foreignobject",
  "iframe",
  "object",
  "embed",
  "audio",
  "video",
  "canvas",
  "link",
  "base",
  "animate",
  "animatetransform",
  "animatemotion",
  "set",
  "handler",
  "listener",
]);

export type SvgParseCode =
  | "no_svg_found"
  | "truncated"
  | "malformed_xml"
  | "not_svg_root"
  | "empty_drawing";

export class SvgParseError extends Error {
  readonly code: SvgParseCode;

  constructor(code: SvgParseCode, message: string) {
    super(message);
    this.name = "SvgParseError";
    this.code = code;
  }
}

export interface ParsedSvg {
  svg: string;
  warnings: string[];
  stats: {
    bytes: number;
    elements: number;
    paths: number;
  };
}

function tagNameOf(element: unknown): string {
  const candidate = element as { name?: string; tagName?: string };
  return (candidate.name ?? candidate.tagName ?? "").toLowerCase();
}

function isWellFormed(xml: string): boolean {
  let ok = true;
  const parser = new SaxesParser();
  parser.on("error", () => {
    ok = false;
  });
  try {
    parser.write(xml).close();
  } catch {
    ok = false;
  }
  return ok;
}

/**
 * Pulls candidate SVG documents out of a model response.
 *
 * Preference order:
 *  1. Fenced code blocks that contain an <svg> element.
 *  2. The raw slice from the first <svg> to the last </svg>.
 */
export function extractSvgCandidates(raw: string): string[] {
  const text = raw.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").trim();
  const candidates: string[] = [];
  let sawTruncated = false;

  const fencePattern = /```[ \t]*(?:xml|svg|html)?[ \t]*\n?([\s\S]*?)```/gi;
  for (const match of text.matchAll(fencePattern)) {
    const body = match[1]?.trim();
    if (!body || !/<svg[\s>]/i.test(body)) {
      continue;
    }
    if (!/<\/svg>/i.test(body)) {
      sawTruncated = true;
      continue;
    }
    candidates.push(body);
  }

  if (candidates.length === 0) {
    const start = text.search(/<svg[\s>]/i);
    if (start >= 0) {
      const end = text.toLowerCase().lastIndexOf("</svg>");
      if (end > start) {
        candidates.push(text.slice(start, end + "</svg>".length).trim());
      } else {
        throw new SvgParseError("truncated", "The SVG document is not closed");
      }
    }
  }

  if (candidates.length === 0) {
    if (sawTruncated) {
      throw new SvgParseError("truncated", "The SVG document is not closed");
    }
    throw new SvgParseError("no_svg_found", "No <svg> element was found in the response");
  }

  return candidates;
}

function findSvgRoot($: CheerioAPI) {
  const direct = $("svg").first();
  if (direct.length > 0) {
    return direct;
  }

  return $("*")
    .filter((_, element) => tagNameOf(element) === "svg")
    .first();
}

function removeComments($: CheerioAPI): void {
  $.root()
    .find("*")
    .contents()
    .filter((_, node) => node.type === "comment")
    .remove();
  $.root()
    .contents()
    .filter((_, node) => node.type === "comment")
    .remove();
}

function sanitize($: CheerioAPI, warnings: string[]): void {
  // Remove dangerous or non-static elements.
  $("*")
    .filter((_, element) => FORBIDDEN_TAGS.has(tagNameOf(element)))
    .each((_, element) => {
      warnings.push(`removed <${tagNameOf(element)}> element`);
      $(element).remove();
    });

  // The prompt forbids raster embeds; strip them rather than returning them.
  $("*")
    .filter((_, element) => tagNameOf(element) === "image")
    .each((_, element) => {
      warnings.push("removed raster <image> element");
      $(element).remove();
    });

  // Attribute-level sanitization.
  $("*").each((_, element) => {
    const attribs = (element as { attribs?: Record<string, string> }).attribs;
    if (!attribs) {
      return;
    }

    for (const [name, value] of Object.entries(attribs)) {
      const lower = name.toLowerCase();

      if (lower.startsWith("on")) {
        $(element).removeAttr(name);
        warnings.push(`removed event handler attribute ${name}`);
        continue;
      }

      if (lower === "src") {
        $(element).removeAttr(name);
        warnings.push("removed src attribute");
        continue;
      }

      if (lower === "href" || lower === "xlink:href") {
        if (value.length > 0 && !value.trim().startsWith("#")) {
          $(element).removeAttr(name);
          warnings.push(`removed external reference ${name}`);
        }
        continue;
      }

      if (
        /javascript:/i.test(value) ||
        /data:text\/html/i.test(value) ||
        /expression\s*\(/i.test(value) ||
        /behavior\s*:/i.test(value) ||
        /-moz-binding/i.test(value)
      ) {
        $(element).removeAttr(name);
        warnings.push(`removed unsafe value from ${name}`);
        continue;
      }

      if (/url\s*\(\s*['"]?(?!#)/i.test(value)) {
        $(element).removeAttr(name);
        warnings.push(`removed external url() from ${name}`);
      }
    }
  });

  // Stylesheets may only reference local fragments.
  $("*")
    .filter((_, element) => tagNameOf(element) === "style")
    .each((_, element) => {
      const css = $(element).text();
      if (/@import|expression\s*\(|javascript:|url\s*\(\s*['"]?(?!#)/i.test(css)) {
        $(element).remove();
        warnings.push("removed unsafe <style> block");
      }
    });

  removeComments($);
}

function normalizeTagCase($: CheerioAPI): void {
  // Models occasionally emit ALL-CAPS SVG tags. Lowercase those, but leave
  // camelCase SVG tags such as <linearGradient> and <clipPath> untouched.
  $("*").each((_, element) => {
    const candidate = element as { name?: string; tagName?: string };
    const name = candidate.name ?? candidate.tagName ?? "";
    if (name.length > 1 && name === name.toUpperCase() && !name.includes(":")) {
      const lower = name.toLowerCase();
      candidate.name = lower;
      candidate.tagName = lower;
    }
  });
}

const LASH_ID_PATTERN = /lash/i;
const LASH_FOREGROUND_PARENT =
  /glint|gloss|glaze|highlight|shine|sheen|catchlight|specular/i;

/**
 * Style lint for the filled-lash rule: v011 replaces uniform stroked arcs with
 * tapered filled silhouettes. Warnings surface regressions in the review UI.
 */
function lintLashStyles($: CheerioAPI, warnings: string[]): void {
  $("*").each((_, element) => {
    const $el = $(element);
    const id = $el.attr("id");
    if (!id || !LASH_ID_PATTERN.test(id)) {
      return;
    }
    const tag = tagNameOf(element);
    if (!DRAWABLE_TAGS.has(tag)) {
      return;
    }

    if (tag === "line" || tag === "polyline") {
      warnings.push(
        `lash "${id}" is a <${tag}>; expected a closed filled path`,
      );
    }

    const fill = ($el.attr("fill") ?? "").trim().toLowerCase();
    const stroke = ($el.attr("stroke") ?? "").trim().toLowerCase();
    if (fill === "none") {
      warnings.push(
        `lash "${id}" has fill="none"; expected a filled tapered silhouette`,
      );
    }
    if (stroke && stroke !== "none") {
      warnings.push(
        `lash "${id}" uses a stroke; expected fill with stroke="none"`,
      );
    }

    let cursor = $el.parent();
    let depth = 0;
    while (cursor.length > 0 && depth < 64) {
      const current = cursor.get(0);
      if (!current || tagNameOf(current) === "svg") {
        break;
      }
      if (cursor.attr("clip-path")) {
        warnings.push(
          `lash "${id}" is inside a clipped group; lashes must stay outside the eye clip`,
        );
        break;
      }
      cursor = cursor.parent();
      depth += 1;
    }

    const parentId = $el.parent().attr("id") ?? "";
    if (LASH_FOREGROUND_PARENT.test(parentId)) {
      warnings.push(
        `lash "${id}" is nested in "${parentId}"; expected a direct child of the eye group`,
      );
    }
  });
}

function normalizeRoot($: CheerioAPI, warnings: string[]): void {
  const root = findSvgRoot($);
  if (root.length === 0) {
    throw new SvgParseError("not_svg_root", "The document has no <svg> root element");
  }

  const element = root.get(0) as { name?: string; tagName?: string } | undefined;
  if (element && tagNameOf(element) !== "svg") {
    element.name = "svg";
    element.tagName = "svg";
  }

  root.attr("xmlns", SVG_NS);

  const viewBox = root.attr("viewBox") ?? root.attr("viewbox");
  if (!viewBox) {
    root.attr("viewBox", CANONICAL_VIEWBOX);
    warnings.push("added default viewBox");
  } else {
    if (root.attr("viewbox") !== undefined) {
      root.removeAttr("viewbox");
      root.attr("viewBox", viewBox);
    }
    if (viewBox.trim().replace(/\s+/g, " ") !== CANONICAL_VIEWBOX) {
      warnings.push(`unexpected viewBox "${viewBox.trim()}"`);
    }
  }

  root.attr("width", "100%");
  root.attr("height", "100%");

  $("*")
    .filter((_, node) => tagNameOf(node) === "metadata")
    .remove();
}

/**
 * Extracts, validates, sanitizes, and normalizes an SVG from a model response.
 */
export function parseSvg(raw: string): ParsedSvg {
  const candidates = extractSvgCandidates(raw);
  const warnings: string[] = [];

  const wellFormedCandidates = candidates.filter((candidate) =>
    isWellFormed(candidate),
  );
  const pool =
    wellFormedCandidates.length > 0 ? wellFormedCandidates : candidates;
  const selected = pool.reduce((longest, candidate) =>
    candidate.length > longest.length ? candidate : longest,
  );
  const selectedWellFormed = wellFormedCandidates.length > 0;

  if (!selectedWellFormed) {
    warnings.push("input was not well-formed XML; repaired leniently");
  }

  let $: CheerioAPI;
  try {
    $ = load(selected, { xmlMode: true });
  } catch {
    throw new SvgParseError("malformed_xml", "The SVG could not be parsed");
  }

  sanitize($, warnings);
  normalizeTagCase($);
  normalizeRoot($, warnings);
  lintLashStyles($, warnings);

  const root = findSvgRoot($);
  if (root.length === 0) {
    throw new SvgParseError("not_svg_root", "The document has no <svg> root element");
  }

  const drawableCount = $("*").filter((_, element) =>
    DRAWABLE_TAGS.has(tagNameOf(element)),
  ).length;

  if (drawableCount === 0) {
    throw new SvgParseError("empty_drawing", "The SVG contains no drawable elements");
  }

  const svg = $.xml(root);
  if (!/^<svg[\s>]/i.test(svg)) {
    throw new SvgParseError("malformed_xml", "The serialized SVG is invalid");
  }

  return {
    svg,
    warnings,
    stats: {
      bytes: Buffer.byteLength(svg, "utf8"),
      elements: $("*").length,
      paths: $("*").filter((_, element) => tagNameOf(element) === "path").length,
    },
  };
}
