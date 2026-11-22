import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { createPublicationBundle } from "../src/services/publication.js";
import {
  parsePublicationManifest,
  type PublicationManifest,
} from "../src/services/publication-manifest.js";
import type { ParallaxRig } from "../src/services/parallax.js";
import {
  ConversionStore,
  type ConversionRecordInput,
} from "../src/services/store.js";

const PROMPT = {
  version: "prompt-publication",
  text: "You are a vector illustrator.",
  path: "/tmp/prompt.md",
};

const RIG: ParallaxRig = {
  format: "vector.parallax",
  version: 1,
  viewBox: [0, 0, 1024, 1024],
  cursor: { space: "normalized", neutral: [0.5, 0.5] },
  defaults: {
    shift: 40,
    scale: 0.06,
    rotate: 1.5,
    proximity: 0.55,
    direction: "inverse",
    neutralZ: 0.5,
  },
  nodes: [],
  anchors: [],
  synthetic: false,
  warnings: [],
};

const SVG_WITH_DEPTH =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="100%" height="100%">' +
  '<g id="back" data-z="0.2" data-pivot="512,512"><rect x="100" y="100" width="824" height="824" fill="#ccc"/></g>' +
  '<g id="front" data-z="0.8" data-pivot="512,512"><circle cx="512" cy="512" r="200" fill="#f00"/></g>' +
  "</svg>";

// A real decodable image so the publish-time downsample has something to work
// with; the longest side (800) exceeds the 384 px publication cap.
const INPUT_PNG = await sharp({
  create: {
    width: 800,
    height: 600,
    channels: 3,
    background: { r: 200, g: 100, b: 50 },
  },
})
  .png()
  .toBuffer();

function makeEntry(
  promptId: number,
  overrides: Partial<ConversionRecordInput> = {},
): ConversionRecordInput {
  return {
    requestId: `req-${Math.random().toString(36).slice(2)}`,
    status: "success",
    model: "test/model",
    promptId,
    attempts: 1,
    input: {
      mime: "image/png",
      width: 800,
      height: 600,
      bytes: INPUT_PNG.length,
      originalWidth: 800,
      originalHeight: 600,
      originalBytes: INPUT_PNG.length,
      downsampled: false,
      data: INPUT_PNG,
    },
    output: {
      svg: SVG_WITH_DEPTH,
      bytes: Buffer.byteLength(SVG_WITH_DEPTH),
      elements: 2,
      paths: 1,
      rig: RIG,
      warnings: [],
    },
    metrics: {
      latencyMs: 100,
      upstreamLatencyMs: 90,
      promptTokens: 10,
      completionTokens: 20,
      totalTokens: 30,
      cachedTokens: 0,
      reasoningTokens: 0,
      costUsd: null,
      calls: [],
    },
    error: null,
    ...overrides,
  };
}

function setup() {
  const store = new ConversionStore(":memory:");
  const promptId = store.upsertPrompt(PROMPT);
  const outDir = mkdtempSync(path.join(tmpdir(), "vector-publication-"));
  return { store, promptId, outDir };
}

describe("createPublicationBundle", () => {
  it("writes a manifest and assets for every selected rating", async () => {
    const { store, promptId, outDir } = setup();
    const niceId = store.record(makeEntry(promptId, { requestId: "nice" }));
    const fairId = store.record(makeEntry(promptId, { requestId: "fair" }));
    const badId = store.record(makeEntry(promptId, { requestId: "bad" }));
    store.setSelection(niceId, "nice");
    store.setSelection(fairId, "fair");
    store.setSelection(badId, "bad");

    const result = await createPublicationBundle({
      store,
      outDir,
      intro: "A short publication intro.",
      generatedAt: new Date("2026-11-16T00:00:00.000Z"),
    });

    expect(result.counts).toEqual({ nice: 1, fair: 1, bad: 1, total: 3 });
    expect(result.manifest.items).toHaveLength(3);
    const manifest = parsePublicationManifest(
      JSON.parse(readFileSync(result.manifestPath, "utf8")),
    ) as PublicationManifest;
    expect(manifest.format).toBe("vector.publication");
    expect(manifest.intro).toBe("A short publication intro.");
    expect(manifest.generatedAt).toBe("2026-11-16T00:00:00.000Z");
    expect(manifest.items.map((item) => item.rating)).toEqual([
      "nice",
      "fair",
      "bad",
    ]);

    for (const item of manifest.items) {
      expect(item.assets.input.endsWith(".webp")).toBe(true);
      const input = readFileSync(path.join(outDir, item.assets.input));
      const metadata = await sharp(input).metadata();
      expect(metadata.format).toBe("webp");
      expect(Math.max(metadata.width ?? 0, metadata.height ?? 0)).toBeLessThanOrEqual(
        384,
      );
      expect(item.inputWidth).toBe(metadata.width);
      expect(item.inputHeight).toBe(metadata.height);
      expect(readFileSync(path.join(outDir, item.assets.svg), "utf8")).toContain(
        "<svg",
      );
      expect(
        JSON.parse(readFileSync(path.join(outDir, item.assets.rig), "utf8"))
          .format,
      ).toBe("vector.parallax");
    }

    store.close();
    rmSync(outDir, { recursive: true, force: true });
  });

  it("derives a rig for historical conversions without a stored one", async () => {
    const { store, promptId, outDir } = setup();
    const id = store.record(
      makeEntry(promptId, {
        output: {
          svg: SVG_WITH_DEPTH,
          bytes: Buffer.byteLength(SVG_WITH_DEPTH),
          elements: 2,
          paths: 1,
          rig: null,
          warnings: [],
        },
      }),
    );
    store.setSelection(id, "nice");

    const result = await createPublicationBundle({ store, outDir });
    const item = result.manifest.items[0];
    expect(item).toBeDefined();
    const rig = JSON.parse(
      readFileSync(path.join(outDir, item!.assets.rig), "utf8"),
    ) as ParallaxRig;
    expect(rig.nodes.length).toBeGreaterThan(0);

    store.close();
    rmSync(outDir, { recursive: true, force: true });
  });

  it("publishes a featured-only conversion without an input image", async () => {
    const { store, promptId, outDir } = setup();
    const id = store.record(makeEntry(promptId, { input: null }));
    store.setFeatured(id);

    const result = await createPublicationBundle({
      store,
      outDir,
      intro: "A featured-only publication.",
    });

    expect(result.manifest.items).toEqual([]);
    expect(result.featured?.id).toBe(id);
    expect(result.featured?.rating).toBeNull();
    const featured = result.manifest.featured;
    expect(featured).toBeDefined();
    expect(Object.keys(featured!.assets).sort()).toEqual(["rig", "svg"]);
    expect(readFileSync(path.join(outDir, featured!.assets.svg), "utf8")).toContain(
      "<svg",
    );
    expect(
      JSON.parse(readFileSync(path.join(outDir, featured!.assets.rig), "utf8"))
        .format,
    ).toBe("vector.parallax");
    expect(
      readdirSync(path.join(outDir, "assets")).some((name) =>
        name.startsWith(`featured-${id}-input`),
      ),
    ).toBe(false);

    store.close();
    rmSync(outDir, { recursive: true, force: true });
  });

  it("keeps the featured conversion out of the rated galleries", async () => {
    const { store, promptId, outDir } = setup();
    const featuredId = store.record(
      makeEntry(promptId, { requestId: "featured" }),
    );
    const galleryId = store.record(makeEntry(promptId, { requestId: "gallery" }));
    store.setSelection(featuredId, "nice");
    store.setSelection(galleryId, "nice");
    store.setFeatured(featuredId);

    const result = await createPublicationBundle({ store, outDir });

    expect(result.manifest.items.map((item) => item.id)).toEqual([galleryId]);
    expect(result.manifest.featured?.id).toBe(featuredId);
    expect(result.manifest.featured?.rating).toBe("nice");
    expect(result.counts).toEqual({ nice: 2, fair: 0, bad: 0, total: 2 });

    store.close();
    rmSync(outDir, { recursive: true, force: true });
  });

  it("falls back to the stored bytes when the input cannot be decoded", async () => {
    const { store, promptId, outDir } = setup();
    const raw = Buffer.from([1, 2, 3, 4]);
    const id = store.record(
      makeEntry(promptId, {
        input: {
          mime: "image/png",
          width: 100,
          height: 80,
          bytes: raw.length,
          originalWidth: 100,
          originalHeight: 80,
          originalBytes: raw.length,
          downsampled: false,
          data: raw,
        },
      }),
    );
    store.setSelection(id, "nice");

    const result = await createPublicationBundle({ store, outDir });

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/could not be downsampled/);
    const item = result.manifest.items[0]!;
    expect(item.assets.input.endsWith(".png")).toBe(true);
    expect(readFileSync(path.join(outDir, item.assets.input))).toEqual(raw);

    store.close();
    rmSync(outDir, { recursive: true, force: true });
  });

  it("rejects empty selections and overlong intros", async () => {
    const { store, promptId, outDir } = setup();
    await expect(createPublicationBundle({ store, outDir })).rejects.toThrow(
      /Select at least one/,
    );

    const id = store.record(makeEntry(promptId));
    store.setSelection(id, "nice");
    const words = Array.from({ length: 100 }, () => "word").join(" ");
    await expect(
      createPublicationBundle({ store, outDir, intro: words }),
    ).rejects.toThrow(/less than 100 words/);

    store.close();
    rmSync(outDir, { recursive: true, force: true });
  });

  it("fails when a selected conversion has no stored input", async () => {
    const { store, promptId, outDir } = setup();
    const id = store.record(makeEntry(promptId, { input: null }));
    store.setSelection(id, "nice");

    await expect(createPublicationBundle({ store, outDir })).rejects.toThrow(
      /no stored input image/,
    );

    store.close();
    rmSync(outDir, { recursive: true, force: true });
  });
});
