import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  extractSvgCandidates,
  parseSvg,
  SvgParseError,
} from "../src/services/svg-parser.js";

const fixturesDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "responses",
);

function fixture(name: string): string {
  return readFileSync(path.join(fixturesDir, name), "utf8");
}

function expectParseError(fn: () => unknown, code: string): void {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(SvgParseError);
    expect((error as SvgParseError).code).toBe(code);
    return;
  }
  throw new Error(`Expected SvgParseError with code ${code}`);
}

describe("extractSvgCandidates", () => {
  it("finds fenced blocks and ignores reasoning", () => {
    const candidates = extractSvgCandidates(fixture("fenced-with-reasoning.txt"));
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toContain("<svg");
    expect(candidates[0]).not.toContain("<reasoning>");
  });

  it("falls back to a raw <svg> slice", () => {
    const candidates = extractSvgCandidates(fixture("no-fence.txt"));
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.startsWith("<svg")).toBe(true);
    expect(candidates[0]?.endsWith("</svg>")).toBe(true);
  });

  it("throws truncated when the document is not closed", () => {
    expectParseError(
      () => extractSvgCandidates(fixture("truncated.txt")),
      "truncated",
    );
  });

  it("throws no_svg_found for prose-only responses", () => {
    expectParseError(
      () => extractSvgCandidates("I cannot help with that."),
      "no_svg_found",
    );
  });
});

describe("parseSvg", () => {
  it("extracts and normalizes a fenced SVG after reasoning", () => {
    const result = parseSvg(fixture("fenced-with-reasoning.txt"));

    expect(result.svg.startsWith("<svg")).toBe(true);
    expect(result.svg).toContain('viewBox="0 0 1024 1024"');
    expect(result.svg).toContain('width="100%"');
    expect(result.svg).toContain('height="100%"');
    expect(result.svg).not.toContain("<reasoning>");
    expect(result.stats.paths).toBe(2);
    expect(result.warnings).toEqual([]);
  });

  it("extracts a ```svg fenced block", () => {
    const result = parseSvg(fixture("fenced-svg.txt"));
    expect(result.svg).toContain("<circle");
    expect(result.svg).toContain('fill="#3366ff"');
  });

  it("extracts an unfenced SVG and drops surrounding prose", () => {
    const result = parseSvg(fixture("no-fence.txt"));
    expect(result.svg).toContain("<rect");
    expect(result.svg).not.toContain("Here is the vector");
    expect(result.svg).not.toContain("Let me know");
  });

  it("picks the longest parseable candidate", () => {
    const result = parseSvg(fixture("multiple-blocks.txt"));
    expect(result.svg).toContain("<circle");
    expect(result.svg).toContain("<rect");
    expect(result.stats.paths).toBe(1);
  });

  it("rejects a truncated document", () => {
    expectParseError(() => parseSvg(fixture("truncated.txt")), "truncated");
  });

  it("strips raster <image> embeds and warns", () => {
    const result = parseSvg(fixture("raster-embed.txt"));
    expect(result.svg).not.toContain("<image");
    expect(result.warnings.join(" ")).toContain("raster <image>");
  });

  it("removes scripts, event handlers, external refs, and unsafe styles", () => {
    const result = parseSvg(fixture("unsafe.txt"));
    const warnings = result.warnings.join(" ");

    expect(result.svg).not.toContain("<script");
    expect(result.svg).not.toContain("onclick");
    expect(result.svg).not.toContain("evil.example");
    expect(result.svg).not.toContain("@import");
    expect(warnings).toContain("<script>");
    expect(warnings).toContain("event handler");
    expect(warnings).toContain("external reference");
    expect(warnings).toContain("unsafe <style>");
  });

  it("repairs a non-XML named entity leniently", () => {
    const result = parseSvg(fixture("malformed-entity.txt"));
    expect(result.svg).toContain("Hello");
    expect(result.warnings.join(" ")).toContain("not well-formed");
  });

  it("rejects an SVG with no drawable elements", () => {
    expectParseError(() => parseSvg(fixture("empty.txt")), "empty_drawing");
  });

  it("normalizes ALL-CAPS SVG tags", () => {
    const result = parseSvg(fixture("uppercase.txt"));
    expect(result.svg.startsWith("<svg")).toBe(true);
    expect(result.svg).toContain("<path");
    expect(result.svg).not.toContain("<PATH");
  });

  it("adds a default viewBox when missing", () => {
    const result = parseSvg(fixture("missing-viewbox.txt"));
    expect(result.svg).toContain('viewBox="0 0 1024 1024"');
    expect(result.warnings.join(" ")).toContain("added default viewBox");
  });

  it("warns about a non-canonical viewBox", () => {
    const result = parseSvg(fixture("wrong-viewbox.txt"));
    expect(result.svg).toContain('viewBox="0 0 512 512"');
    expect(result.warnings.join(" ")).toContain("unexpected viewBox");
  });
});
