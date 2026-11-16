import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildSite } from "../scripts/build-site.js";

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="100%" height="100%">' +
  '<rect x="100" y="100" width="824" height="824" fill="#ccc"/></svg>';

const RIG = {
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

function makeManifest(intro = "A short publication intro.") {
  return {
    format: "vector.publication",
    version: 1,
    title: "Selected vector studies",
    intro,
    generatedAt: "2026-11-16T00:00:00.000Z",
    items: [
      {
        id: 11,
        rating: "nice",
        title: "Conversion #11",
        model: "test/model",
        promptVersion: "v015",
        createdAt: 1,
        inputWidth: 100,
        inputHeight: 80,
        assets: {
          input: "assets/0011-input.png",
          svg: "assets/0011.svg",
          rig: "assets/0011.rig.json",
        },
      },
      {
        id: 12,
        rating: "fair",
        title: "Conversion #12",
        model: "test/model",
        promptVersion: "v015",
        createdAt: 2,
        inputWidth: 100,
        inputHeight: 80,
        assets: {
          input: "assets/0012-input.png",
          svg: "assets/0012.svg",
          rig: "assets/0012.rig.json",
        },
      },
    ],
  };
}

function makeFeatured() {
  return {
    id: 99,
    rating: "nice",
    title: "Conversion #99",
    model: "test/model",
    promptVersion: "v015",
    createdAt: 3,
    assets: {
      svg: "assets/featured-99.svg",
      rig: "assets/featured-99.rig.json",
    },
  };
}

type TestManifest = ReturnType<typeof makeManifest> & {
  featured?: ReturnType<typeof makeFeatured>;
};

function setup() {
  const dir = mkdtempSync(path.join(tmpdir(), "vector-build-site-"));
  mkdirSync(path.join(dir, "assets"), { recursive: true });
  for (const name of ["0011", "0012"]) {
    writeFileSync(path.join(dir, "assets", `${name}-input.png`), Buffer.from([1, 2, 3]));
    writeFileSync(path.join(dir, "assets", `${name}.svg`), SVG);
    writeFileSync(
      path.join(dir, "assets", `${name}.rig.json`),
      JSON.stringify(RIG),
    );
  }
  writeFileSync(path.join(dir, "assets", "featured-99.svg"), SVG);
  writeFileSync(
    path.join(dir, "assets", "featured-99.rig.json"),
    JSON.stringify(RIG),
  );
  const manifestPath = path.join(dir, "selections.json");
  writeFileSync(manifestPath, JSON.stringify(makeManifest()));
  const outDir = path.join(dir, "site");
  return { dir, manifestPath, outDir };
}

describe("buildSite", () => {
  it("renders stacked rating sections and copies the site assets", async () => {
    const { dir, manifestPath, outDir } = setup();
    const result = await buildSite({
      rootDir: process.cwd(),
      manifestPath,
      outDir,
      builtAt: new Date("2026-11-16T09:28:46.654Z"),
    });

    expect(result.counts).toEqual({ nice: 1, fair: 1, bad: 0 });
    const html = readFileSync(path.join(outDir, "index.html"), "utf8");
    expect(html).toContain('<p class="eyebrow">Mantis</p>');
    expect(html).toContain("<h1>Selected vector studies</h1>");
    expect(html).toContain("<title>Mantis · Selected vector studies</title>");
    expect(html).toContain("Last published at");
    expect(html).toContain("Nov 16, 2026, 09:28 UTC");
    expect(html).toMatch(/href="https:\/\/github\.com\/[^"]+"/);
    expect(html).toContain("GitHub repository");
    expect(html).toContain('id="viewer-tilt"');
    expect(html).toContain('class="tilt-toggle"');
    expect(html).not.toContain("Enable tilt");
    expect(html).not.toContain("gallery result");
    expect(html).not.toContain("tag publish");
    expect(html).toContain('id="good"');
    expect(html).toContain('id="fair"');
    expect(html).toContain('id="bad"');
    expect(html).toContain("No results in this tier.");
    expect(html).toContain("A short publication intro.");
    expect(html).toContain('data-index="0"');
    expect(html).toContain('data-index="1"');
    expect(html).toContain("./assets/0011.svg");
    expect(html).toContain("./assets/0012-input.png");

    expect(readFileSync(path.join(outDir, "publication.json"), "utf8")).toContain(
      '"rating": "nice"',
    );
    expect(existsSync(path.join(outDir, "publish.css"))).toBe(true);
    expect(existsSync(path.join(outDir, "publish.js"))).toBe(true);
    expect(existsSync(path.join(outDir, "parallax-player.js"))).toBe(true);
    expect(existsSync(path.join(outDir, ".nojekyll"))).toBe(true);

    rmSync(dir, { recursive: true, force: true });
  });

  it("renders a featured idle hero outside the galleries", async () => {
    const { dir, manifestPath, outDir } = setup();
    const manifest: TestManifest = makeManifest();
    manifest.items = [manifest.items[0]!];
    manifest.featured = makeFeatured();
    writeFileSync(manifestPath, JSON.stringify(manifest));

    const result = await buildSite({
      rootDir: process.cwd(),
      manifestPath,
      outDir,
    });

    expect(result.itemCount).toBe(1);
    const html = readFileSync(path.join(outDir, "index.html"), "utf8");
    expect(html).toContain('class="hero has-feature"');
    expect(html).toContain('id="featured-stage"');
    expect(html).toContain("./assets/featured-99.svg");
    expect(html).toContain("Featured vector sample");
    expect(html).toContain('data-index="0"');
    expect(html).not.toContain('data-index="1"');
    expect(
      readFileSync(path.join(outDir, "publication.json"), "utf8"),
    ).toContain('"featured"');
    expect(existsSync(path.join(outDir, "assets", "featured-99.svg"))).toBe(
      true,
    );

    rmSync(dir, { recursive: true, force: true });
  });

  it("allows a featured-only publication", async () => {
    const { dir, manifestPath, outDir } = setup();
    const manifest: TestManifest = makeManifest();
    manifest.items = [];
    manifest.featured = makeFeatured();
    writeFileSync(manifestPath, JSON.stringify(manifest));

    const result = await buildSite({
      rootDir: process.cwd(),
      manifestPath,
      outDir,
    });

    expect(result.itemCount).toBe(0);
    expect(result.counts).toEqual({ nice: 0, fair: 0, bad: 0 });
    const html = readFileSync(path.join(outDir, "index.html"), "utf8");
    expect(html).toContain('class="hero has-feature"');
    expect(html).toContain('id="featured-stage"');
    expect(html).toContain("No results in this tier.");

    rmSync(dir, { recursive: true, force: true });
  });

  it("rejects a featured conversion that also appears in a gallery", async () => {
    const { dir, manifestPath, outDir } = setup();
    const manifest: TestManifest = makeManifest();
    manifest.featured = {
      ...makeFeatured(),
      id: manifest.items[0]!.id,
    };
    writeFileSync(manifestPath, JSON.stringify(manifest));
    await expect(
      buildSite({ rootDir: process.cwd(), manifestPath, outDir }),
    ).rejects.toThrow(/must not also appear/);
    rmSync(dir, { recursive: true, force: true });
  });

  it("supports validate-only checks without writing the site", async () => {
    const { dir, manifestPath, outDir } = setup();
    const result = await buildSite({
      rootDir: process.cwd(),
      manifestPath,
      outDir,
      check: true,
    });
    expect(result.itemCount).toBe(2);
    expect(existsSync(outDir)).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });

  it("rejects an intro of 100 words", async () => {
    const { dir, manifestPath, outDir } = setup();
    writeFileSync(
      manifestPath,
      JSON.stringify(
        makeManifest(Array.from({ length: 100 }, () => "word").join(" ")),
      ),
    );
    await expect(
      buildSite({ rootDir: process.cwd(), manifestPath, outDir }),
    ).rejects.toThrow(/less than 100 words/);
    rmSync(dir, { recursive: true, force: true });
  });

  it("rejects missing assets", async () => {
    const { dir, manifestPath, outDir } = setup();
    rmSync(path.join(dir, "assets", "0012.svg"));
    await expect(
      buildSite({ rootDir: process.cwd(), manifestPath, outDir }),
    ).rejects.toThrow(/Missing svg asset/);
    rmSync(dir, { recursive: true, force: true });
  });
});
