import { load, type CheerioAPI } from "cheerio";

const DEFAULT_VIEWBOX: [number, number, number, number] = [0, 0, 1024, 1024];

const SKIP_TAGS = new Set([
  "defs",
  "clippath",
  "mask",
  "lineargradient",
  "radialgradient",
  "pattern",
  "symbol",
  "marker",
  "metadata",
  "style",
  "title",
  "desc",
]);

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

export interface Linear2D {
  const: number;
  cx: number;
  cy: number;
}

export interface Scale2D {
  const: number;
  cx: number;
  cy: number;
  proximity: number;
  radius: number;
  /** Proximity value at the neutral cursor; subtracted so neutral is identity. */
  neutral: number;
}

export interface ParallaxNode {
  id: string;
  tag: string;
  /** Absolute depth in the illustration, 0 far … 1 near. */
  z: number;
  /** Depth of the nearest animated ancestor (or the neutral depth). */
  parentZ: number;
  /** Depth relative to the parent; the coefficients are expressed in this space. */
  depth: number;
  pivot: [number, number];
  gain: number;
  baseTransform: string | null;
  translate: { x: Linear2D; y: Linear2D };
  scale: Scale2D;
  rotate: Linear2D;
}

export interface ParallaxRig {
  format: "vector.parallax";
  version: 1;
  viewBox: [number, number, number, number];
  cursor: { space: "normalized"; neutral: [number, number] };
  defaults: {
    shift: number;
    scale: number;
    rotate: number;
    proximity: number;
    direction: "inverse" | "direct";
    neutralZ: number;
  };
  nodes: ParallaxNode[];
  /** True when depth was inferred from paint order instead of authored data-z. */
  synthetic: boolean;
  warnings: string[];
}

export interface DeriveParallaxOptions {
  /** Maximum translation in viewBox units at |depth| = 0.5 and |cursor offset| = 1. */
  shift?: number;
  /** Maximum scale delta at |depth| = 0.5 and full proximity. */
  scale?: number;
  /** Maximum rotation in degrees at |depth| = 0.5 and |cursor offset| = 1. */
  rotate?: number;
  /** Proximity radius in normalized canvas units. */
  proximity?: number;
  direction?: "inverse" | "direct";
  neutralZ?: number;
  fallback?: "paint-order" | "none";
}

export interface DeriveParallaxResult {
  svg: string;
  rig: ParallaxRig;
}

export interface ParallaxCursor {
  x: number;
  y: number;
}

export interface ParallaxMultipliers {
  shift?: number;
  scale?: number;
  rotate?: number;
}

export interface ParallaxMotion {
  tx: number;
  ty: number;
  scale: number;
  rotate: number;
}

const DEFAULT_OPTIONS = {
  shift: 40,
  scale: 0.06,
  rotate: 1.5,
  proximity: 0.55,
  direction: "inverse" as const,
  neutralZ: 0.5,
  fallback: "paint-order" as const,
};

interface ElementInfo {
  // Cheerio's element node type is deliberately loose here; the helpers below
  // only rely on tag name, attributes, and element children.
  el: unknown;
  tag: string;
  parent: ElementInfo | null;
  children: ElementInfo[];
  order: number;
  id: string | undefined;
  zAttr: string | undefined;
  pivotAttr: string | undefined;
  gain: number;
  hasClip: boolean;
  opacity: number;
  baseTransform: string | undefined;
  isGroup: boolean;
  isDrawable: boolean;
  hasAncestorTransform: boolean;
}

function tagNameOf(element: unknown): string {
  const candidate = element as { name?: string; tagName?: string };
  return (candidate.name ?? candidate.tagName ?? "").toLowerCase();
}

function describeElement(info: ElementInfo): string {
  return `<${info.tag}${info.id ? ` id="${info.id}"` : ""}>`;
}

function parsePivot(value: string | undefined): [number, number] | undefined {
  if (!value) {
    return undefined;
  }
  const parts = value.trim().split(/[\s,]+/).map(Number);
  if (parts.length < 2) {
    return undefined;
  }
  const x = parts[0];
  const y = parts[1];
  if (x === undefined || y === undefined || !Number.isFinite(x) || !Number.isFinite(y)) {
    return undefined;
  }
  return [x, y];
}

function parseGain(value: string | undefined): number {
  if (!value) {
    return 1;
  }
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function parseOpacity(value: string | undefined): number {
  if (!value) {
    return 1;
  }
  const trimmed = value.trim();
  if (trimmed.endsWith("%")) {
    const parsed = Number.parseFloat(trimmed);
    return Number.isFinite(parsed) ? Math.min(1, Math.max(0, parsed / 100)) : 1;
  }
  const parsed = Number.parseFloat(trimmed);
  return Number.isFinite(parsed) ? Math.min(1, Math.max(0, parsed)) : 1;
}

function parseViewBox(
  value: string | undefined,
  warnings: string[],
): [number, number, number, number] {
  if (!value) {
    warnings.push("missing viewBox; using 0 0 1024 1024");
    return [...DEFAULT_VIEWBOX];
  }
  const parts = value.trim().split(/[\s,]+/).map(Number);
  const [x, y, width, height] = parts;
  if (
    parts.length !== 4 ||
    x === undefined ||
    y === undefined ||
    width === undefined ||
    height === undefined ||
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    warnings.push(`invalid viewBox "${value}"; using 0 0 1024 1024`);
    return [...DEFAULT_VIEWBOX];
  }
  return [x, y, width, height];
}

function buildTree($: CheerioAPI): { root: ElementInfo; all: ElementInfo[] } {
  let order = 0;
  const all: ElementInfo[] = [];

  function visit(
    el: unknown,
    parent: ElementInfo | null,
    ancestorTransform: boolean,
  ): ElementInfo | null {
    const tag = tagNameOf(el);
    if (!tag || SKIP_TAGS.has(tag)) {
      return null;
    }

    const $el = $(el as never);
    const info: ElementInfo = {
      el,
      tag,
      parent,
      children: [],
      order: order,
      id: $el.attr("id"),
      zAttr: $el.attr("data-z"),
      pivotAttr: $el.attr("data-pivot"),
      gain: parseGain($el.attr("data-parallax")),
      hasClip: $el.attr("clip-path") !== undefined,
      opacity: parseOpacity($el.attr("opacity") ?? $el.attr("fill-opacity")),
      baseTransform: $el.attr("transform"),
      isGroup: tag === "g",
      isDrawable: DRAWABLE_TAGS.has(tag),
      hasAncestorTransform: ancestorTransform,
    };
    order += 1;
    all.push(info);

    const nextAncestorTransform = ancestorTransform || Boolean(info.baseTransform);
    for (const child of $el.children().toArray()) {
      const childInfo = visit(child, info, nextAncestorTransform);
      if (childInfo) {
        info.children.push(childInfo);
      }
    }

    return info;
  }

  const rootEl = $("svg").first().get(0);
  const root = rootEl ? visit(rootEl, null, false) : null;
  if (!root) {
    throw new Error("The SVG has no <svg> root element");
  }
  return { root, all };
}

function geometryPivot(
  $: CheerioAPI,
  info: ElementInfo,
): [number, number] | undefined {
  const $el = $(info.el as never);
  const num = (name: string, fallback = 0): number => {
    const value = Number.parseFloat($el.attr(name) ?? "");
    return Number.isFinite(value) ? value : fallback;
  };

  switch (info.tag) {
    case "circle":
    case "ellipse":
      return [num("cx"), num("cy")];
    case "rect":
      return [num("x") + num("width") / 2, num("y") + num("height") / 2];
    case "line":
      return [(num("x1") + num("x2")) / 2, (num("y1") + num("y2")) / 2];
    case "text":
      return [num("x"), num("y")];
    case "polygon":
    case "polyline": {
      const points = ($el.attr("points") ?? "")
        .trim()
        .split(/[\s,]+/)
        .map(Number)
        .filter((value) => Number.isFinite(value));
      let sx = 0;
      let sy = 0;
      let count = 0;
      for (let index = 0; index + 1 < points.length; index += 2) {
        sx += points[index] ?? 0;
        sy += points[index + 1] ?? 0;
        count += 1;
      }
      return count > 0 ? [sx / count, sy / count] : undefined;
    }
    default:
      return undefined;
  }
}

function findSyntheticWrapper(root: ElementInfo): ElementInfo | null {
  const topGroups = root.children.filter((child) => child.isGroup && child.id);
  if (topGroups.length !== 1) {
    return null;
  }
  const wrapper = topGroups[0];
  return wrapper && wrapper.children.length > 0 ? wrapper : null;
}

/**
 * Moves a highlight primitive's clip-path onto a static wrapper so the
 * primitive can slide inside the mask when its own transform is animated.
 * Groups keep their clip: their transform should move the silhouette too.
 */
function wrapPrimitiveClip(
  $: CheerioAPI,
  info: ElementInfo,
  warnings: string[],
): void {
  if (!info.isDrawable || !info.hasClip) {
    return;
  }

  const $el = $(info.el as never);
  const clip = $el.attr("clip-path");
  if (!clip) {
    return;
  }

  if (info.baseTransform) {
    warnings.push(
      `animated <${info.tag}> has both clip-path and transform; clip left in place`,
    );
    return;
  }

  $el.removeAttr("clip-path");
  const wrapper = $("<g></g>");
  wrapper.attr("clip-path", clip);
  $el.before(wrapper);
  wrapper.append($el);
}

function formatNumber(value: number): string {
  const rounded = Math.round(value * 10000) / 10000;
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

/**
 * Derives cursor-driven position/scale/rotation functions from an SVG whose
 * elements carry `data-z` depth annotations.
 *
 * The returned SVG may contain injected ids and clip wrappers, so it must be
 * stored alongside the rig; the two are only meaningful together.
 */
export function deriveParallaxRig(
  svg: string,
  options: DeriveParallaxOptions = {},
): DeriveParallaxResult {
  const settings = {
    shift: options.shift ?? DEFAULT_OPTIONS.shift,
    scale: options.scale ?? DEFAULT_OPTIONS.scale,
    rotate: options.rotate ?? DEFAULT_OPTIONS.rotate,
    proximity: options.proximity ?? DEFAULT_OPTIONS.proximity,
    direction: options.direction ?? DEFAULT_OPTIONS.direction,
    neutralZ: options.neutralZ ?? DEFAULT_OPTIONS.neutralZ,
    fallback: options.fallback ?? DEFAULT_OPTIONS.fallback,
  };

  const warnings: string[] = [];
  const $ = load(svg, { xmlMode: true });
  const rootEl = $("svg").first();

  if (rootEl.length === 0) {
    throw new Error("The SVG has no <svg> root element");
  }
  if (!rootEl.attr("xmlns")) {
    rootEl.attr("xmlns", "http://www.w3.org/2000/svg");
  }

  const viewBox = parseViewBox(rootEl.attr("viewBox"), warnings);
  const { root, all } = buildTree($);
  const center: [number, number] = [
    viewBox[0] + viewBox[2] / 2,
    viewBox[1] + viewBox[3] / 2,
  ];

  const hasExplicitZ = all.some((info) => info.zAttr !== undefined);
  const synthetic = !hasExplicitZ && settings.fallback === "paint-order";

  const explicitZ = new Map<ElementInfo, number>();
  if (hasExplicitZ) {
    for (const info of all) {
      if (info.zAttr === undefined) {
        continue;
      }
      const parsed = Number.parseFloat(info.zAttr);
      if (!Number.isFinite(parsed)) {
        warnings.push(
          `ignored non-numeric data-z "${info.zAttr}" on <${info.tag}>`,
        );
        continue;
      }
      let z = parsed;
      if (z < 0 || z > 1) {
        warnings.push(`clamped data-z ${z} on <${info.tag}> to [0,1]`);
        z = Math.min(1, Math.max(0, z));
      }
      explicitZ.set(info, z);
    }
  }

  const animated: ElementInfo[] = [];
  const zByInfo = new Map<ElementInfo, number>();

  if (synthetic) {
    const wrapper = findSyntheticWrapper(root);
    const candidates = all.filter((info) => {
      if (info === root || info === wrapper) {
        return false;
      }
      if (info.isGroup) {
        return Boolean(info.id);
      }
      if (!info.isDrawable) {
        return false;
      }
      return info.hasClip || info.opacity < 1;
    });

    const selected =
      candidates.length > 0
        ? candidates
        : all.filter(
            (info) =>
              info.parent === root && (info.isGroup || info.isDrawable),
          );

    selected.sort((left, right) => left.order - right.order);
    selected.forEach((info, index) => {
      const z =
        selected.length <= 1
          ? 0.5
          : 0.1 + (0.8 * index) / (selected.length - 1);
      zByInfo.set(info, z);
      animated.push(info);
    });
  } else {
    for (const info of all) {
      const z = explicitZ.get(info);
      if (z === undefined) {
        continue;
      }
      zByInfo.set(info, z);
      animated.push(info);
    }
    animated.sort((left, right) => left.order - right.order);
  }

  // Ensure every animated element has a unique, stable id.
  const existingIds = new Set<string>();
  for (const info of all) {
    if (info.id) {
      existingIds.add(info.id);
    }
  }

  const claimedIds = new Set<string>();
  const idByInfo = new Map<ElementInfo, string>();
  let generated = 0;

  for (const info of animated) {
    let id = info.id;
    if (!id || claimedIds.has(id)) {
      if (id && !synthetic) {
        warnings.push(
          `duplicate id "${id}" on <${info.tag}>; generated a unique id`,
        );
      }
      do {
        generated += 1;
        id = `parallax-${generated}`;
      } while (existingIds.has(id) || claimedIds.has(id));
      $(info.el as never).attr("id", id);
    }
    claimedIds.add(id);
    existingIds.add(id);
    idByInfo.set(info, id);
  }

  // Nearest animated ancestor, used to express motion relative to the parent.
  const animatedSet = new Set(animated);
  const parentAnimated = new Map<ElementInfo, ElementInfo | null>();
  for (const info of animated) {
    let cursor = info.parent;
    while (cursor && !animatedSet.has(cursor)) {
      cursor = cursor.parent;
    }
    parentAnimated.set(info, cursor);
  }

  const pivotByInfo = new Map<ElementInfo, [number, number]>();
  const nodes: ParallaxNode[] = [];

  for (const info of animated) {
    const z = zByInfo.get(info) ?? settings.neutralZ;
    const parent = parentAnimated.get(info) ?? null;
    const parentZ = parent
      ? (zByInfo.get(parent) ?? settings.neutralZ)
      : settings.neutralZ;
    const depth = z - parentZ;

    const pivotAttr = info.pivotAttr;
    let pivot = info.pivotAttr ? parsePivot(info.pivotAttr) : undefined;
    if (pivotAttr && !pivot && !synthetic) {
      warnings.push(
        `invalid data-pivot "${pivotAttr}" on <${info.tag}>; using geometry`,
      );
    }
    pivot ??= geometryPivot($, info);
    pivot ??= parent ? pivotByInfo.get(parent) : undefined;
    pivot ??= center;
    if (!info.pivotAttr && !synthetic && !parent) {
      warnings.push(
        `animated <${info.tag}> has no data-pivot; using its geometry center`,
      );
    }
    pivotByInfo.set(info, pivot);

    if (!synthetic && info.baseTransform) {
      warnings.push(
        `animated <${info.tag}> has a transform attribute; the rig will compose it`,
      );
    }
    if (!synthetic && info.hasAncestorTransform) {
      warnings.push(
        `animated ${describeElement(info)} is inside a transformed ancestor; pivot may be offset`,
      );
    }

    wrapPrimitiveClip($, info, synthetic ? [] : warnings);

    const id = idByInfo.get(info);
    if (!id) {
      continue;
    }

    const direction = settings.direction === "direct" ? 1 : -1;
    const translateGain = direction * settings.shift * depth * info.gain;
    const scaleGain = settings.scale * depth * info.gain * 2;
    const rotateGain = settings.rotate * depth * info.gain * 2;

    const normalizedX = (pivot[0] - viewBox[0]) / viewBox[2];
    const normalizedY = (pivot[1] - viewBox[1]) / viewBox[3];
    const neutralDist =
      Math.hypot(0.5 - normalizedX, 0.5 - normalizedY) / Math.SQRT2;
    const neutral =
      settings.proximity > 0
        ? Math.exp(-((neutralDist / settings.proximity) ** 2))
        : 0;

    nodes.push({
      id,
      tag: info.tag,
      z,
      parentZ,
      depth,
      pivot,
      gain: info.gain,
      baseTransform: info.baseTransform ?? null,
      translate: {
        x: { const: 0, cx: translateGain, cy: 0 },
        y: { const: 0, cx: 0, cy: translateGain },
      },
      scale: {
        const: 1,
        cx: 0,
        cy: 0,
        proximity: scaleGain,
        radius: settings.proximity,
        neutral,
      },
      rotate: {
        const: 0,
        cx: rotateGain,
        cy: -rotateGain,
      },
    });
  }

  if (!synthetic) {
    if (nodes.length === 0) {
      warnings.push("no usable data-z attributes were found");
    } else {
      const zValues = nodes.map((node) => node.z);
      const spread = Math.max(...zValues) - Math.min(...zValues);
      if (spread < 0.35) {
        warnings.push(
          `depth spread is ${spread.toFixed(2)}; at least 0.35 is recommended for visible parallax`,
        );
      }

      const siblingGroups = new Map<ElementInfo | null, ElementInfo[]>();
      for (const info of animated) {
        const parent = parentAnimated.get(info) ?? null;
        const list = siblingGroups.get(parent) ?? [];
        list.push(info);
        siblingGroups.set(parent, list);
      }
      for (const list of siblingGroups.values()) {
        list.sort((left, right) => left.order - right.order);
        for (let index = 1; index < list.length; index += 1) {
          const previous = list[index - 1];
          const current = list[index];
          if (!previous || !current) {
            continue;
          }
          const previousZ = zByInfo.get(previous);
          const currentZ = zByInfo.get(current);
          if (
            previousZ !== undefined &&
            currentZ !== undefined &&
            currentZ < previousZ
          ) {
            warnings.push(
              `paint order is not ascending by data-z near <${current.tag}> ` +
                `(${previousZ.toFixed(2)} → ${currentZ.toFixed(2)})`,
            );
          }
        }
      }
    }
  }

  const rig: ParallaxRig = {
    format: "vector.parallax",
    version: 1,
    viewBox,
    cursor: { space: "normalized", neutral: [0.5, 0.5] },
    defaults: {
      shift: settings.shift,
      scale: settings.scale,
      rotate: settings.rotate,
      proximity: settings.proximity,
      direction: settings.direction,
      neutralZ: settings.neutralZ,
    },
    nodes,
    synthetic,
    warnings: [...new Set(warnings)],
  };

  return { svg: $.xml(rootEl), rig };
}

/**
 * Evaluates one node's motion for a normalized cursor position.
 *
 * `multipliers` scales the motion deltas only, so the neutral state stays
 * identity when a UI slider is at zero.
 */
export function evaluateParallaxNode(
  node: ParallaxNode,
  cursor: ParallaxCursor,
  viewBox: [number, number, number, number],
  multipliers: ParallaxMultipliers = {},
): ParallaxMotion {
  const cx = (cursor.x - 0.5) * 2;
  const cy = (cursor.y - 0.5) * 2;
  const shift = multipliers.shift ?? 1;
  const scaleMultiplier = multipliers.scale ?? 1;
  const rotateMultiplier = multipliers.rotate ?? 1;

  const tx =
    node.translate.x.const +
    (node.translate.x.cx * cx + node.translate.x.cy * cy) * shift;
  const ty =
    node.translate.y.const +
    (node.translate.y.cx * cx + node.translate.y.cy * cy) * shift;

  const [viewX, viewY, viewWidth, viewHeight] = viewBox;
  const pivotX = (node.pivot[0] - viewX) / viewWidth;
  const pivotY = (node.pivot[1] - viewY) / viewHeight;
  const distance =
    Math.hypot(cursor.x - pivotX, cursor.y - pivotY) / Math.SQRT2;
  const radius = node.scale.radius;
  const proximity =
    radius > 0
      ? Math.exp(-((distance / radius) ** 2)) - node.scale.neutral
      : 0;
  const scaleDelta =
    node.scale.cx * cx + node.scale.cy * cy + node.scale.proximity * proximity;
  const scale = node.scale.const + scaleDelta * scaleMultiplier;

  const rotate =
    node.rotate.const +
    (node.rotate.cx * cx + node.rotate.cy * cy) * rotateMultiplier;

  return { tx, ty, scale, rotate };
}

/** Builds the SVG transform string for one node at the given cursor. */
export function transformForNode(
  node: ParallaxNode,
  cursor: ParallaxCursor,
  viewBox: [number, number, number, number],
  multipliers: ParallaxMultipliers = {},
): string {
  const motion = evaluateParallaxNode(node, cursor, viewBox, multipliers);
  const [pivotX, pivotY] = node.pivot;
  return (
    `translate(${formatNumber(motion.tx)} ${formatNumber(motion.ty)}) ` +
    `translate(${formatNumber(pivotX)} ${formatNumber(pivotY)}) ` +
    `rotate(${formatNumber(motion.rotate)}) ` +
    `scale(${formatNumber(motion.scale)}) ` +
    `translate(${formatNumber(-pivotX)} ${formatNumber(-pivotY)})`
  );
}
