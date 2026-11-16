import { load } from "cheerio";
import { describe, expect, it } from "vitest";
import {
  combineMotions,
  deriveParallaxRig,
  evaluateIdleNode,
  evaluateParallaxNode,
  nodePoint,
  resolveAnchorCorrections,
  resolveRigTransforms,
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

const ANCHOR_SVG = [
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="100%" height="100%">',
  '  <g id="subject" data-z="0.5" data-pivot="512,512">',
  '    <g id="torso" data-z="0.32" data-pivot="500,480" data-sockets="neck:760,560 shoulder-left:560,470">',
  '      <path id="torso-base" d="M 400 400 L 700 400 L 700 700 L 400 700 Z" fill="#888888" stroke="none"/>',
  "    </g>",
  '    <g id="head" data-z="0.55" data-sockets="crown:760,470" data-anchor="neck">',
  '      <path id="head-base" d="M 650 400 L 880 400 L 880 620 L 650 620 Z" fill="#cccccc" stroke="none"/>',
  '      <g id="left-eye" data-z="0.66" data-pivot="720,520">',
  '        <circle cx="720" cy="520" r="30" fill="#111111" stroke="none"/>',
  "      </g>",
  "    </g>",
  '    <g id="headwear" data-z="0.62" data-anchor="crown" data-pivot="760,470">',
  '      <path id="headwear-base" d="M 690 380 L 830 380 L 830 470 L 690 470 Z" fill="#ff8800" stroke="none"/>',
  "    </g>",
  '    <g id="front-arm" data-z="0.7" data-anchor="shoulder-left" data-pivot="560,470">',
  '      <path id="arm-base" d="M 520 440 L 600 440 L 600 760 L 520 760 Z" fill="#aaaaaa" stroke="none"/>',
  "    </g>",
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

describe("parallax joint welds", () => {
  const multipliers = { shift: 2, scale: 3.33, rotate: 3.33 };

  function jointFor(rig: ReturnType<typeof deriveParallaxRig>["rig"], id: string, point: [number, number], cursor: { x: number; y: number }) {
    const node = nodeById(rig.nodes, id);
    const motion = evaluateParallaxNode(node, cursor, rig.viewBox, multipliers);
    const correction = resolveAnchorCorrections(
      rig,
      cursor,
      rig.viewBox,
      multipliers,
    ).get(id);
    return nodePoint(node, motion, point, correction);
  }

  it("derives sockets and anchor welds with joint pivots", () => {
    const { rig } = deriveParallaxRig(ANCHOR_SVG);

    expect(rig.version).toBe(2);
    expect(rig.warnings).toEqual([]);
    expect(rig.anchors.map((anchor) => anchor.id)).toEqual([
      "neck",
      "crown",
      "shoulder-left",
    ]);

    const neck = rig.anchors[0];
    expect(neck?.host).toBe("torso");
    expect(neck?.point).toEqual([760, 560]);
    expect(neck?.members).toEqual([{ node: "head", frame: "shared" }]);

    const head = nodeById(rig.nodes, "head");
    expect(head.pivot).toEqual([760, 560]);
    expect(head.weld).toBe(1);

    // The nested eye is not anchored; it inherits the head's weld.
    const eye = nodeById(rig.nodes, "left-eye");
    expect(eye.pivot).toEqual([720, 520]);
    expect(rig.anchors.some((anchor) =>
      anchor.members.some((member) => member.node === "left-eye"),
    )).toBe(false);
  });

  it("keeps multi-hop joints pinned at cursor extremes", () => {
    const { rig } = deriveParallaxRig(ANCHOR_SVG);

    for (const cursor of [
      { x: 1, y: 0.5 },
      { x: 0.1, y: 0.9 },
      { x: 0.5, y: 0 },
    ]) {
      const torsoNeck = jointFor(rig, "torso", [760, 560], cursor);
      const headNeck = jointFor(rig, "head", [760, 560], cursor);
      expect(headNeck[0]).toBeCloseTo(torsoNeck[0], 8);
      expect(headNeck[1]).toBeCloseTo(torsoNeck[1], 8);

      const headCrown = jointFor(rig, "head", [760, 470], cursor);
      const headwearCrown = jointFor(rig, "headwear", [760, 470], cursor);
      expect(headwearCrown[0]).toBeCloseTo(headCrown[0], 8);
      expect(headwearCrown[1]).toBeCloseTo(headCrown[1], 8);

      const torsoShoulder = jointFor(rig, "torso", [560, 470], cursor);
      const armShoulder = jointFor(rig, "front-arm", [560, 470], cursor);
      expect(armShoulder[0]).toBeCloseTo(torsoShoulder[0], 8);
      expect(armShoulder[1]).toBeCloseTo(torsoShoulder[1], 8);
    }
  });

  it("cancels relative translation for a weld inside the host's frame", () => {
    const svg = [
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">',
      '  <g id="torso" data-z="0.3" data-pivot="500,500" data-sockets="neck:700,500">',
      '    <rect x="400" y="400" width="200" height="200" fill="#888"/>',
      '    <g id="head" data-z="0.7" data-anchor="neck">',
      '      <rect x="650" y="380" width="100" height="120" fill="#ccc"/>',
      "    </g>",
      "  </g>",
      "</svg>",
    ].join("\n");

    const { rig } = deriveParallaxRig(svg);
    expect(rig.warnings).toEqual([]);
    expect(rig.anchors[0]?.members).toEqual([
      { node: "head", frame: "local" },
    ]);

    const cursor = { x: 1, y: 0.2 };
    const head = nodeById(rig.nodes, "head");
    const motion = evaluateParallaxNode(head, cursor, rig.viewBox, multipliers);
    const correction = resolveAnchorCorrections(
      rig,
      cursor,
      rig.viewBox,
      multipliers,
    ).get("head");
    const joint = nodePoint(head, motion, [700, 500], correction);
    expect(joint[0]).toBeCloseTo(700, 8);
    expect(joint[1]).toBeCloseTo(500, 8);
  });

  it("actually corrects a visible separation", () => {
    const { rig } = deriveParallaxRig(ANCHOR_SVG);
    const cursor = { x: 1, y: 0.5 };
    const head = nodeById(rig.nodes, "head");
    const torso = nodeById(rig.nodes, "torso");
    const motion = (node: ParallaxNode) =>
      evaluateParallaxNode(node, cursor, rig.viewBox, multipliers);

    const rawHead = nodePoint(head, motion(head), [760, 560]);
    const rawTorso = nodePoint(torso, motion(torso), [760, 560]);
    const rawGap = Math.hypot(rawHead[0] - rawTorso[0], rawHead[1] - rawTorso[1]);
    expect(rawGap).toBeGreaterThan(2);
  });

  it("is identity at the neutral cursor", () => {
    const { rig } = deriveParallaxRig(ANCHOR_SVG);
    const corrections = resolveAnchorCorrections(
      rig,
      { x: 0.5, y: 0.5 },
      rig.viewBox,
    );
    for (const correction of corrections.values()) {
      expect(correction.dx).toBeCloseTo(0, 10);
      expect(correction.dy).toBeCloseTo(0, 10);
    }
  });

  it("honours a partial weld", () => {
    const svg = ANCHOR_SVG.replace(
      'data-anchor="shoulder-left"',
      'data-anchor="shoulder-left" data-weld="0.5"',
    );
    const cursor = { x: 1, y: 0.5 };
    const full = deriveParallaxRig(ANCHOR_SVG).rig;
    const half = deriveParallaxRig(svg).rig;
    const fullCorrection = resolveAnchorCorrections(
      full,
      cursor,
      full.viewBox,
      multipliers,
    ).get("front-arm");
    const halfCorrection = resolveAnchorCorrections(
      half,
      cursor,
      half.viewBox,
      multipliers,
    ).get("front-arm");

    expect(nodeById(half.nodes, "front-arm").weld).toBe(0.5);
    expect(halfCorrection?.dx).toBeCloseTo((fullCorrection?.dx ?? 0) * 0.5, 10);
    expect(halfCorrection?.dy).toBeCloseTo((fullCorrection?.dy ?? 0) * 0.5, 10);
  });

  it("emits warnings for malformed weld metadata", () => {
    const svg = [
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">',
      '  <g id="subject" data-z="0.5" data-pivot="512,512">',
      '    <g id="body" data-z="0.35" data-pivot="500,500" data-sockets="neck:700,500 neck:710,500">',
      '      <rect x="400" y="400" width="200" height="200" fill="#888"/>',
      "    </g>",
      '    <g id="head" data-z="0.6" data-anchor="neck" data-pivot="600,500">',
      '      <rect x="650" y="400" width="100" height="100" fill="#ccc"/>',
      "    </g>",
      '    <g id="hat" data-z="0.7" data-anchor="missing" data-pivot="700,450">',
      '      <rect x="660" y="380" width="80" height="40" fill="#f80"/>',
      "    </g>",
      '    <g id="static" data-anchor="neck">',
      '      <rect x="0" y="0" width="10" height="10" fill="#000"/>',
      "    </g>",
      "  </g>",
      "</svg>",
    ].join("\n");

    const { rig } = deriveParallaxRig(svg);
    const warnings = rig.warnings.join(" ");

    expect(warnings).toContain("duplicate socket name");
    expect(warnings).toContain("has no matching data-sockets");
    expect(warnings).toContain("has no data-z");
    expect(warnings).toContain("from its socket");
  });

  it("rejects anchor cycles", () => {
    const svg = [
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">',
      '  <g id="subject" data-z="0.5" data-pivot="512,512">',
      '    <g id="a" data-z="0.3" data-pivot="300,300" data-sockets="to-b:300,300" data-anchor="to-a">',
      '      <rect x="0" y="0" width="10" height="10" fill="#888"/>',
      "    </g>",
      '    <g id="b" data-z="0.6" data-pivot="700,700" data-sockets="to-a:700,700" data-anchor="to-b">',
      '      <rect x="0" y="0" width="10" height="10" fill="#ccc"/>',
      "    </g>",
      "  </g>",
      "</svg>",
    ].join("\n");

    const { rig } = deriveParallaxRig(svg);
    expect(rig.warnings.join(" ")).toContain("creates a cycle");
    expect(rig.anchors).toHaveLength(1);
  });

  it("resolves every node transform with weld corrections", () => {
    const { rig } = deriveParallaxRig(ANCHOR_SVG);
    const transforms = resolveRigTransforms(rig, { x: 1, y: 1 }, multipliers);

    expect(transforms.size).toBe(rig.nodes.length);
    expect(transforms.get("pivot")).toBeUndefined();
    expect(transforms.get("head")).toContain("translate(");
  });

  it("leaves rigs without anchors at version 1", () => {
    const { rig } = deriveParallaxRig(DEPTH_SVG);
    expect(rig.version).toBe(1);
    expect(rig.anchors).toEqual([]);
  });
});

const IDLE_SVG = [
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">',
  '  <defs><clipPath id="clip-eye"><path d="M 0 0 L 100 0 L 100 100 Z"/></clipPath></defs>',
  '  <g id="subject" data-z="0.5" data-pivot="512,512" data-anim="bob" data-anim-period="3" data-anim-amplitude="8">',
  '    <g id="body" data-z="0.3" data-pivot="500,500" data-anim="breathe" data-anim-amplitude="0.02">',
  '      <rect x="400" y="400" width="200" height="200" fill="#888"/>',
  "    </g>",
  '    <g id="head" data-z="0.65" data-pivot="600,400" data-anim="nod" data-anim-amplitude="3">',
  '      <rect x="550" y="350" width="100" height="100" fill="#ccc"/>',
  '      <g id="left-eye" data-z="0.7" data-pivot="600,400" data-anim="blink" data-anim-period="4" data-anim-amplitude="0.9" clip-path="url(#clip-eye)">',
  '        <circle cx="600" cy="400" r="20" fill="#111"/>',
  "      </g>",
  "    </g>",
  "  </g>",
  "</svg>",
].join("\n");

const IDLE_ANCHOR_SVG = [
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">',
  '  <g id="subject" data-z="0.5" data-pivot="512,512">',
  '    <g id="torso" data-z="0.3" data-pivot="500,500" data-sockets="neck:700,500" data-anim="breathe" data-anim-amplitude="0.05">',
  '      <rect x="400" y="400" width="200" height="200" fill="#888"/>',
  "    </g>",
  '    <g id="head" data-z="0.7" data-anchor="neck" data-pivot="700,500" data-anim="nod" data-anim-amplitude="3">',
  '      <rect x="650" y="400" width="100" height="100" fill="#ccc"/>',
  "    </g>",
  "  </g>",
  "</svg>",
].join("\n");

describe("idle motion", () => {
  it("derives idle tracks and bumps the rig version to 3", () => {
    const { rig } = deriveParallaxRig(IDLE_SVG);

    expect(rig.version).toBe(3);
    expect(rig.warnings).toEqual([]);

    const subject = nodeById(rig.nodes, "subject");
    expect(subject.idle?.preset).toBe("bob");
    expect(subject.idle?.translate?.y?.amplitude).toBe(8);

    const body = nodeById(rig.nodes, "body");
    expect(body.idle?.preset).toBe("breathe");
    expect(body.idle?.scale?.x?.amplitude).toBeCloseTo(0.02, 10);
    expect(body.idle?.scale?.y?.amplitude).toBeCloseTo(0.02, 10);

    const eye = nodeById(rig.nodes, "left-eye");
    expect(eye.idle?.preset).toBe("blink");
    expect(eye.idle?.scale?.y?.amplitude).toBeCloseTo(-0.9, 10);
  });

  it("is identity at time zero", () => {
    const { rig } = deriveParallaxRig(IDLE_SVG);

    for (const node of rig.nodes) {
      const idle = evaluateIdleNode(node, 0);
      expect(idle.tx).toBeCloseTo(0, 10);
      expect(idle.ty).toBeCloseTo(0, 10);
      expect(idle.scaleX).toBeCloseTo(1, 10);
      expect(idle.scaleY).toBeCloseTo(1, 10);
      expect(idle.rotate).toBeCloseTo(0, 10);
    }
  });

  it("blinks by scaling the masked eye group", () => {
    const { rig } = deriveParallaxRig(IDLE_SVG);
    const eye = nodeById(rig.nodes, "left-eye");

    let minScaleY = 1;
    for (let time = 0; time < 4; time += 0.005) {
      minScaleY = Math.min(minScaleY, evaluateIdleNode(eye, time).scaleY);
    }

    expect(minScaleY).toBeLessThan(0.5);
    expect(minScaleY).toBeGreaterThan(0);
  });

  it("emits a non-uniform scale for a blink", () => {
    const { rig } = deriveParallaxRig(IDLE_SVG);
    const eye = nodeById(rig.nodes, "left-eye");

    let minScaleY = 1;
    let peakTime = 0;
    for (let time = 0; time < 4; time += 0.005) {
      const scaleY = evaluateIdleNode(eye, time).scaleY;
      if (scaleY < minScaleY) {
        minScaleY = scaleY;
        peakTime = time;
      }
    }

    const transform = transformForNode(
      eye,
      { x: 0.5, y: 0.5 },
      rig.viewBox,
      {},
      undefined,
      peakTime,
    );
    expect(transform).toContain("scale(1 ");
  });

  it("composes idle motion with cursor parallax", () => {
    const { rig } = deriveParallaxRig(IDLE_SVG);
    const head = nodeById(rig.nodes, "head");
    const idle = evaluateIdleNode(head, 1.2);

    const centered = combineMotions(
      evaluateParallaxNode(head, { x: 0.5, y: 0.5 }, rig.viewBox),
      idle,
    );
    expect(centered.tx).toBeCloseTo(idle.tx, 10);
    expect(centered.ty).toBeCloseTo(idle.ty, 10);
    expect(centered.rotate).toBeCloseTo(idle.rotate, 10);

    const moved = combineMotions(
      evaluateParallaxNode(head, { x: 1, y: 0.5 }, rig.viewBox),
      idle,
    );
    const parallax = evaluateParallaxNode(head, { x: 1, y: 0.5 }, rig.viewBox);
    expect(moved.tx).toBeCloseTo(parallax.tx + idle.tx, 10);
    expect(moved.rotate).toBeCloseTo(parallax.rotate + idle.rotate, 10);
  });

  it("keeps welds pinned while the host idles", () => {
    const { rig } = deriveParallaxRig(IDLE_ANCHOR_SVG);
    const cursor = { x: 0.5, y: 0.5 };
    const time = 1.1;
    const corrections = resolveAnchorCorrections(
      rig,
      cursor,
      rig.viewBox,
      {},
      time,
    );

    const torso = nodeById(rig.nodes, "torso");
    const head = nodeById(rig.nodes, "head");
    const motion = (node: ParallaxNode) =>
      combineMotions(
        evaluateParallaxNode(node, cursor, rig.viewBox),
        evaluateIdleNode(node, time),
      );

    const torsoJoint = nodePoint(
      torso,
      motion(torso),
      [700, 500],
      corrections.get("torso"),
    );
    const headJoint = nodePoint(
      head,
      motion(head),
      [700, 500],
      corrections.get("head"),
    );

    expect(headJoint[0]).toBeCloseTo(torsoJoint[0], 8);
    expect(headJoint[1]).toBeCloseTo(torsoJoint[1], 8);
  });

  it("warns about unknown presets and blink targets without a clip", () => {
    const svg = [
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">',
      '  <g id="subject" data-z="0.5" data-pivot="512,512">',
      '    <g id="body" data-z="0.3" data-pivot="500,500" data-anim="dance">',
      '      <rect x="400" y="400" width="200" height="200" fill="#888"/>',
      "    </g>",
      '    <g id="left-eye" data-z="0.6" data-pivot="600,400" data-anim="blink">',
      '      <circle cx="600" cy="400" r="20" fill="#111"/>',
      "    </g>",
      "  </g>",
      "</svg>",
    ].join("\n");

    const { rig } = deriveParallaxRig(svg);
    const warnings = rig.warnings.join(" ");

    expect(warnings).toContain("unknown data-anim preset");
    expect(warnings).toContain("has no clip-path");
  });

  it("warns when data-anim is present without data-z", () => {
    const svg = [
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">',
      '  <g id="subject" data-z="0.5" data-pivot="512,512">',
      '    <g id="body" data-pivot="500,500" data-anim="breathe">',
      '      <rect x="400" y="400" width="200" height="200" fill="#888"/>',
      "    </g>",
      "  </g>",
      "</svg>",
    ].join("\n");

    const { rig } = deriveParallaxRig(svg);
    expect(rig.warnings.join(" ")).toContain("has no data-z");
  });

  it("warns when an anchored part uses a translating preset", () => {
    const svg = [
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">',
      '  <g id="subject" data-z="0.5" data-pivot="512,512">',
      '    <g id="torso" data-z="0.3" data-pivot="500,500" data-sockets="neck:700,500">',
      '      <rect x="400" y="400" width="200" height="200" fill="#888"/>',
      "    </g>",
      '    <g id="head" data-z="0.7" data-anchor="neck" data-pivot="700,500" data-anim="bob">',
      '      <rect x="650" y="400" width="100" height="100" fill="#ccc"/>',
      "    </g>",
      "  </g>",
      "</svg>",
    ].join("\n");

    const { rig } = deriveParallaxRig(svg);
    expect(rig.warnings.join(" ")).toContain("translates an anchored part");
  });

  it("leaves rigs without data-anim free of idle tracks", () => {
    const { rig } = deriveParallaxRig(DEPTH_SVG);
    expect(rig.version).toBe(1);
    expect(nodeById(rig.nodes, "head").idle).toBeUndefined();
  });
});
