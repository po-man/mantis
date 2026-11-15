import { load } from "cheerio";
import { describe, expect, it } from "vitest";
import {
  deriveParallaxRig,
  evaluateParallaxNode,
  transformForNode,
  type ParallaxNode,
} from "../src/services/parallax.js";

const DEPTH_SVG = [
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="100%" height="100%">',
  "  <defs>",
  '    <clipPath id="clip-body"><path d="M 0 0 L 100 0 L 100 100 Z"/></clipPath>',
  "  </defs>",
  '  <g id="subject" data-z="0.5" data-pivot="512,512">',
  '    <g id="body" data-z="0.35" data-pivot="450,600" clip-path="url(#clip-body)">',
  '      <path d="M 0 0 L 100 0 L 100 100 Z" fill="#888888" stroke="none"/>',
  '      <circle id="body-sheen" data-z="0.44" data-pivot="360,520" cx="360" cy="520" r="220" fill="#ffffff" opacity="0.4" clip-path="url(#clip-body)"/>',
  "    </g>",
  '    <g id="head" data-z="0.62" data-pivot="650,450">',
  '      <path d="M 500 400 L 800 400 L 800 700 Z" fill="#cccccc" stroke="none"/>',
  '      <g id="eyes" data-z="0.72" data-parallax="1.3" data-pivot="680,420">',
  '        <circle cx="620" cy="420" r="30" fill="#111111" stroke="none"/>',
  "      </g>",
  "    </g>",
  "  </g>",
  "</svg>",
].join("\n");

const LEGACY_SVG = [
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="100%" height="100%">',
  "  <defs>",
  '    <clipPath id="clip-body"><path d="M 0 0 L 100 0 L 100 100 Z"/></clipPath>',
  "  </defs>",
  '  <g id="piglet">',
  '    <g id="back"><rect x="100" y="200" width="80" height="100" fill="#ddd"/></g>',
  '    <g id="body">',
  '      <path d="M 0 0 L 100 0 L 100 100 Z" fill="#eee"/>',
  '      <circle cx="40" cy="40" r="60" fill="#fff" opacity="0.4" clip-path="url(#clip-body)"/>',
  "    </g>",
  '    <g id="front"><circle cx="600" cy="500" r="120" fill="#f00"/></g>',
  "  </g>",
  "</svg>",
].join("\n");

function nodeById(nodes: ParallaxNode[], id: string): ParallaxNode {
  const node = nodes.find((candidate) => candidate.id === id);
  if (!node) {
    throw new Error(`Missing node ${id}`);
  }
  return node;
}

describe("deriveParallaxRig", () => {
  it("derives absolute depth and parent-relative motion coefficients", () => {
    const { rig } = deriveParallaxRig(DEPTH_SVG);

    expect(rig.format).toBe("vector.parallax");
    expect(rig.version).toBe(1);
    expect(rig.synthetic).toBe(false);
    expect(rig.nodes.map((node) => node.id)).toEqual([
      "subject",
      "body",
      "body-sheen",
      "head",
      "eyes",
    ]);

    const subject = nodeById(rig.nodes, "subject");
    expect(subject.z).toBe(0.5);
    expect(subject.depth).toBe(0);
    expect(subject.translate.x.cx).toBeCloseTo(0, 10);
    expect(subject.scale.proximity).toBeCloseTo(0, 10);

    const body = nodeById(rig.nodes, "body");
    expect(body.z).toBe(0.35);
    expect(body.parentZ).toBe(0.5);
    expect(body.depth).toBeCloseTo(-0.15, 10);
    expect(body.translate.x.cx).toBeCloseTo(6, 10);
    expect(body.translate.y.cy).toBeCloseTo(6, 10);

    const sheen = nodeById(rig.nodes, "body-sheen");
    expect(sheen.z).toBe(0.44);
    expect(sheen.parentZ).toBe(0.35);
    expect(sheen.depth).toBeCloseTo(0.09, 10);
    expect(sheen.translate.x.cx).toBeCloseTo(-3.6, 10);
    expect(sheen.pivot).toEqual([360, 520]);

    const head = nodeById(rig.nodes, "head");
    expect(head.z).toBe(0.62);
    expect(head.parentZ).toBe(0.5);
    expect(head.depth).toBeCloseTo(0.12, 10);
    expect(head.translate.x.cx).toBeCloseTo(-4.8, 10);
    expect(head.translate.x.cy).toBe(0);
    expect(head.scale.proximity).toBeCloseTo(0.0144, 10);
    expect(head.rotate.cx).toBeCloseTo(0.36, 10);
    expect(head.rotate.cy).toBeCloseTo(-0.36, 10);

    const eyes = nodeById(rig.nodes, "eyes");
    expect(eyes.z).toBe(0.72);
    expect(eyes.parentZ).toBe(0.62);
    expect(eyes.depth).toBeCloseTo(0.1, 10);
    expect(eyes.gain).toBe(1.3);
    expect(eyes.translate.x.cx).toBeCloseTo(-5.2, 10);
  });

  it("moves a primitive clip onto a static wrapper so highlights can slide", () => {
    const { svg } = deriveParallaxRig(DEPTH_SVG);
    const $ = load(svg, { xmlMode: true });
    const sheen = $("#body-sheen");

    expect(sheen.attr("clip-path")).toBeUndefined();
    expect(sheen.parent().attr("clip-path")).toBe("url(#clip-body)");
    expect(sheen.parent().is("g")).toBe(true);
  });

  it("keeps a group's clip in place so it travels with the group", () => {
    const { svg } = deriveParallaxRig(DEPTH_SVG);
    const $ = load(svg, { xmlMode: true });
    const body = $("#body");

    expect(body.attr("clip-path")).toBe("url(#clip-body)");
  });

  it("infers synthetic depth from paint order for old SVGs", () => {
    const { rig, svg } = deriveParallaxRig(LEGACY_SVG);

    expect(rig.synthetic).toBe(true);
    expect(rig.warnings).toEqual([]);
    expect(rig.nodes.map((node) => node.id)).toEqual([
      "back",
      "body",
      "parallax-1",
      "front",
    ]);
    const zValues = rig.nodes.map((node) => node.z);
    expect(zValues).toHaveLength(4);
    expect(zValues[0]).toBeCloseTo(0.1, 10);
    expect(zValues[1]).toBeCloseTo(0.3666667, 6);
    expect(zValues[2]).toBeCloseTo(0.6333333333333333, 10);
    expect(zValues[3]).toBeCloseTo(0.9, 10);

    const $ = load(svg, { xmlMode: true });
    expect($("#parallax-1").parent().attr("clip-path")).toBe(
      "url(#clip-body)",
    );
  });

  it("can disable the synthetic fallback", () => {
    const { rig } = deriveParallaxRig(LEGACY_SVG, { fallback: "none" });

    expect(rig.synthetic).toBe(false);
    expect(rig.nodes).toHaveLength(0);
    expect(rig.warnings.join(" ")).toContain("no usable data-z");
  });

  it("clamps out-of-range depth and repairs duplicate ids", () => {
    const svg = [
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">',
      '  <g id="a" data-z="1.4" data-pivot="10,10"><rect x="0" y="0" width="10" height="10"/></g>',
      '  <g id="a" data-z="0.2" data-pivot="20,20"><rect x="0" y="0" width="10" height="10"/></g>',
      '  <g id="b" data-z="wat" data-pivot="30,30"><rect x="0" y="0" width="10" height="10"/></g>',
      "</svg>",
    ].join("\n");

    const { rig } = deriveParallaxRig(svg);
    const warnings = rig.warnings.join(" ");

    expect(rig.nodes).toHaveLength(2);
    expect(rig.nodes[0]?.id).toBe("a");
    expect(rig.nodes[0]?.z).toBe(1);
    expect(rig.nodes[1]?.id).toBe("parallax-1");
    expect(warnings).toContain("clamped data-z");
    expect(warnings).toContain("ignored non-numeric data-z");
    expect(warnings).toContain("duplicate id");
  });

  it("warns when the depth spread is too small", () => {
    const svg = [
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">',
      '  <g id="a" data-z="0.5" data-pivot="10,10"><rect x="0" y="0" width="10" height="10"/></g>',
      '  <g id="b" data-z="0.6" data-pivot="20,20"><rect x="0" y="0" width="10" height="10"/></g>',
      "</svg>",
    ].join("\n");

    const { rig } = deriveParallaxRig(svg);
    expect(rig.warnings.join(" ")).toContain("depth spread");
  });
});

describe("parallax evaluation", () => {
  it("is identity at the neutral cursor", () => {
    const { rig } = deriveParallaxRig(DEPTH_SVG);
    const head = nodeById(rig.nodes, "head");
    const motion = evaluateParallaxNode(head, { x: 0.5, y: 0.5 }, rig.viewBox);

    expect(motion.tx).toBeCloseTo(0, 10);
    expect(motion.ty).toBeCloseTo(0, 10);
    expect(motion.scale).toBeCloseTo(1, 10);
    expect(motion.rotate).toBeCloseTo(0, 10);

    expect(transformForNode(head, { x: 0.5, y: 0.5 }, rig.viewBox)).toBe(
      "translate(0 0) translate(650 450) rotate(0) scale(1) translate(-650 -450)",
    );
  });

  it("translates near and far layers in opposite directions", () => {
    const { rig } = deriveParallaxRig(DEPTH_SVG);
    const body = nodeById(rig.nodes, "body");
    const head = nodeById(rig.nodes, "head");

    const bodyMotion = evaluateParallaxNode(body, { x: 1, y: 0.5 }, rig.viewBox);
    const headMotion = evaluateParallaxNode(head, { x: 1, y: 0.5 }, rig.viewBox);

    expect(bodyMotion.tx).toBeCloseTo(6, 10);
    expect(headMotion.tx).toBeCloseTo(-4.8, 10);
    expect(bodyMotion.tx).toBeGreaterThan(0);
    expect(headMotion.tx).toBeLessThan(0);
  });

  it("scales motion deltas without scaling the identity baseline", () => {
    const { rig } = deriveParallaxRig(DEPTH_SVG);
    const head = nodeById(rig.nodes, "head");

    const half = evaluateParallaxNode(head, { x: 1, y: 0.5 }, rig.viewBox, {
      shift: 0.5,
    });
    expect(half.tx).toBeCloseTo(-2.4, 10);

    const neutral = evaluateParallaxNode(head, { x: 0.5, y: 0.5 }, rig.viewBox, {
      scale: 0,
      rotate: 0,
    });
    expect(neutral.scale).toBeCloseTo(1, 10);
    expect(neutral.rotate).toBeCloseTo(0, 10);
  });
});
