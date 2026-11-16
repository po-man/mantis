/*
 * Shared parallax player for the review UI and the published results page.
 *
 * The math here mirrors src/services/parallax.ts. Keep the two in sync when the
 * rig format changes.
 */
(function () {
  "use strict";

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function formatMotion(value) {
    const rounded = Math.round(value * 10000) / 10000;
    return Object.is(rounded, -0) ? "0" : String(rounded);
  }

  function evaluateParallaxMotion(node, cursor, viewBox, multipliers) {
    const cx = (cursor.x - 0.5) * 2;
    const cy = (cursor.y - 0.5) * 2;
    const shift = multipliers.shift;
    const scaleMultiplier = multipliers.scale;
    const rotateMultiplier = multipliers.rotate;

    const tx =
      node.translate.x.const +
      (node.translate.x.cx * cx + node.translate.x.cy * cy) * shift;
    const ty =
      node.translate.y.const +
      (node.translate.y.cx * cx + node.translate.y.cy * cy) * shift;

    const viewX = viewBox[0];
    const viewY = viewBox[1];
    const viewWidth = viewBox[2];
    const viewHeight = viewBox[3];
    const pivotX = (node.pivot[0] - viewX) / viewWidth;
    const pivotY = (node.pivot[1] - viewY) / viewHeight;
    const distance =
      Math.hypot(cursor.x - pivotX, cursor.y - pivotY) / Math.SQRT2;
    const radius = node.scale.radius || 0;
    const proximity =
      radius > 0
        ? Math.exp(-((distance / radius) ** 2)) - (node.scale.neutral || 0)
        : 0;
    const scaleDelta =
      node.scale.cx * cx +
      node.scale.cy * cy +
      node.scale.proximity * proximity;
    const scale = node.scale.const + scaleDelta * scaleMultiplier;
    const rotate =
      node.rotate.const +
      (node.rotate.cx * cx + node.rotate.cy * cy) * rotateMultiplier;

    return { tx: tx, ty: ty, scale: scale, rotate: rotate };
  }

  function evaluateOscillator(oscillator, time) {
    const period = Math.max(0.1, oscillator.period);
    const shifted = time + oscillator.phase * period;
    const local = ((shifted % period) + period) % period;

    switch (oscillator.wave) {
      case "sine": {
        const value = Math.sin((2 * Math.PI * shifted) / period);
        const initial = Math.sin(2 * Math.PI * oscillator.phase);
        return (value - initial) * oscillator.amplitude;
      }
      case "pulse": {
        const width = Math.max(0.001, (oscillator.duty || 0.1) * period);
        if (local > width) return 0;
        const u = local / width;
        return Math.sin(Math.PI * u) ** 2 * oscillator.amplitude;
      }
      case "bounce": {
        const width = Math.max(0.001, (oscillator.duty || 0.35) * period);
        if (local > width) return 0;
        const u = local / width;
        return Math.sin(Math.PI * u) * oscillator.amplitude;
      }
      case "twitch": {
        const width = Math.max(0.001, (oscillator.duty || 0.12) * period);
        if (local > width) return 0;
        const u = local / width;
        const decay = oscillator.decay || 4;
        return (
          Math.exp(-decay * u) *
          Math.sin(2 * Math.PI * 2 * u) *
          oscillator.amplitude
        );
      }
      default:
        return 0;
    }
  }

  function evaluateIdleMotion(node, time) {
    const idle = node.idle;
    if (!idle) {
      return { tx: 0, ty: 0, scaleX: 1, scaleY: 1, rotate: 0 };
    }
    const tx =
      idle.translate && idle.translate.x
        ? evaluateOscillator(idle.translate.x, time)
        : 0;
    const ty =
      idle.translate && idle.translate.y
        ? evaluateOscillator(idle.translate.y, time)
        : 0;
    const sx =
      idle.scale && idle.scale.x
        ? evaluateOscillator(idle.scale.x, time)
        : 0;
    const sy =
      idle.scale && idle.scale.y
        ? evaluateOscillator(idle.scale.y, time)
        : 0;
    const rotate = idle.rotate ? evaluateOscillator(idle.rotate, time) : 0;
    return {
      tx: tx,
      ty: ty,
      scaleX: 1 + sx,
      scaleY: 1 + sy,
      rotate: rotate,
    };
  }

  function combineMotions(parallax, idle) {
    return {
      tx: parallax.tx + idle.tx,
      ty: parallax.ty + idle.ty,
      scale: parallax.scale,
      scaleX: parallax.scale * idle.scaleX,
      scaleY: parallax.scale * idle.scaleY,
      rotate: parallax.rotate + idle.rotate,
    };
  }

  function transformForMotion(node, motion, correction) {
    const dx = correction ? correction.dx : 0;
    const dy = correction ? correction.dy : 0;
    const scaleX = motion.scaleX === undefined ? motion.scale : motion.scaleX;
    const scaleY = motion.scaleY === undefined ? motion.scale : motion.scaleY;
    const scale =
      scaleX === scaleY
        ? "scale(" + formatMotion(scaleX) + ")"
        : "scale(" +
          formatMotion(scaleX) +
          " " +
          formatMotion(scaleY) +
          ")";
    return (
      "translate(" +
      formatMotion(motion.tx + dx) +
      " " +
      formatMotion(motion.ty + dy) +
      ") " +
      "translate(" +
      formatMotion(node.pivot[0]) +
      " " +
      formatMotion(node.pivot[1]) +
      ") " +
      "rotate(" +
      formatMotion(motion.rotate) +
      ") " +
      scale +
      " " +
      "translate(" +
      formatMotion(-node.pivot[0]) +
      " " +
      formatMotion(-node.pivot[1]) +
      ")"
    );
  }

  function nodePoint(node, motion, point, correction) {
    const radians = (motion.rotate * Math.PI) / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    const pivotX = node.pivot[0];
    const pivotY = node.pivot[1];
    const dx = point[0] - pivotX;
    const dy = point[1] - pivotY;
    const scaleX = motion.scaleX === undefined ? motion.scale : motion.scaleX;
    const scaleY = motion.scaleY === undefined ? motion.scale : motion.scaleY;
    const scaledX = scaleX * dx;
    const scaledY = scaleY * dy;
    return [
      pivotX +
        motion.tx +
        (correction ? correction.dx : 0) +
        cos * scaledX -
        sin * scaledY,
      pivotY +
        motion.ty +
        (correction ? correction.dy : 0) +
        sin * scaledX +
        cos * scaledY,
    ];
  }

  function resolveAnchorCorrections(rig, motions) {
    const corrections = new Map();
    for (const node of rig.nodes) {
      corrections.set(node.id, { dx: 0, dy: 0 });
    }
    const anchors = rig.anchors || [];
    if (anchors.length === 0) return corrections;

    const nodeById = new Map();
    for (const node of rig.nodes) nodeById.set(node.id, node);

    const byMember = new Map();
    for (const anchor of anchors) {
      for (const member of anchor.members) {
        const list = byMember.get(member.node) || [];
        list.push(anchor);
        byMember.set(member.node, list);
      }
    }

    const resolved = new Set();
    const resolving = new Set();
    function resolve(id) {
      if (resolved.has(id) || resolving.has(id)) return;
      resolving.add(id);
      const node = nodeById.get(id);
      const motion = motions.get(id);
      if (node && motion) {
        const nodeAnchors = byMember.get(id) || [];
        let sumX = 0;
        let sumY = 0;
        let count = 0;
        for (const anchor of nodeAnchors) {
          resolve(anchor.host);
          const host = nodeById.get(anchor.host);
          const hostMotion = motions.get(anchor.host);
          let membership = null;
          for (const member of anchor.members) {
            if (member.node === id) membership = member;
          }
          if (!host || !hostMotion || !membership) continue;
          const joint = anchor.point;
          const own = nodePoint(node, motion, joint);
          let targetX = joint[0];
          let targetY = joint[1];
          if (membership.frame === "shared") {
            const hostPoint = nodePoint(
              host,
              hostMotion,
              joint,
              corrections.get(anchor.host),
            );
            targetX = hostPoint[0];
            targetY = hostPoint[1];
          }
          const weld = typeof node.weld === "number" ? node.weld : 1;
          sumX += (targetX - own[0]) * weld;
          sumY += (targetY - own[1]) * weld;
          count += 1;
        }
        if (count > 0) {
          corrections.set(id, { dx: sumX / count, dy: sumY / count });
        }
      }
      resolving.delete(id);
      resolved.add(id);
    }

    for (const node of rig.nodes) resolve(node.id);
    return corrections;
  }

  function sanitizeSvg(root) {
    const forbidden = new Set([
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
    const elements = [root].concat(Array.from(root.querySelectorAll("*")));
    for (const element of elements) {
      if (forbidden.has(element.tagName.toLowerCase())) {
        element.remove();
        continue;
      }
      for (const attribute of Array.from(element.attributes)) {
        const name = attribute.name.toLowerCase();
        const value = attribute.value;
        if (name.startsWith("on") || name === "src") {
          element.removeAttribute(attribute.name);
        } else if (
          (name === "href" || name === "xlink:href") &&
          value &&
          !value.trim().startsWith("#")
        ) {
          element.removeAttribute(attribute.name);
        } else if (
          /javascript:|data:text\/html|expression\s*\(|behavior\s*:|-moz-binding/i.test(
            value,
          )
        ) {
          element.removeAttribute(attribute.name);
        }
      }
    }
    for (const style of Array.from(root.querySelectorAll("style"))) {
      if (
        /@import|expression\s*\(|javascript:|url\s*\(\s*['"]?(?!#)/i.test(
          style.textContent || "",
        )
      ) {
        style.remove();
      }
    }
  }

  function create(stage, svgText, rig, options) {
    if (!stage) {
      throw new Error("A stage element is required");
    }
    if (!svgText || !rig || !Array.isArray(rig.nodes)) {
      throw new Error("An SVG and a parallax rig are required");
    }

    const settings = options || {};
    const documentNode = new DOMParser().parseFromString(
      svgText,
      "image/svg+xml",
    );
    if (documentNode.querySelector("parsererror")) {
      throw new Error("The SVG markup could not be parsed");
    }
    let svgRoot = documentNode.documentElement;
    if (!svgRoot || svgRoot.tagName.toLowerCase() !== "svg") {
      svgRoot = documentNode.querySelector("svg");
    }
    if (!svgRoot) {
      throw new Error("No <svg> root element");
    }
    sanitizeSvg(svgRoot);

    let shadow = stage.shadowRoot;
    if (!shadow) {
      shadow = stage.attachShadow({ mode: "open" });
    }
    shadow.replaceChildren();

    const svg = document.importNode(svgRoot, true);
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", "100%");
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
    shadow.appendChild(svg);

    const hasAnchors = Array.isArray(rig.anchors) && rig.anchors.length > 0;
    const overlay = document.createElementNS(svg.namespaceURI, "g");
    overlay.setAttribute("id", "parallax-anchor-overlay");
    overlay.setAttribute("pointer-events", "none");
    svg.appendChild(overlay);

    const byId = new Map();
    for (const element of shadow.querySelectorAll("[id]")) {
      byId.set(element.id, element);
    }

    const nodeById = new Map();
    for (const node of rig.nodes) {
      nodeById.set(node.id, node);
    }

    const baseTransforms = new Map();
    for (const node of rig.nodes) {
      const element = byId.get(node.id);
      if (element) {
        baseTransforms.set(
          node.id,
          element.getAttribute("transform") || node.baseTransform || null,
        );
      }
    }

    const defaults = rig.defaults || {
      shift: 40,
      scale: 0.06,
      rotate: 1.5,
    };
    const multipliers = settings.multipliers || {
      shift: defaults.shift ? 80 / defaults.shift : 1,
      scale: defaults.scale ? 0.2 / defaults.scale : 1,
      rotate: defaults.rotate ? 5 / defaults.rotate : 1,
    };

    const prefersReducedMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const state = {
      target: { x: 0.5, y: 0.5 },
      current: { x: 0.5, y: 0.5 },
      raf: 0,
      lastTime: 0,
      time: 0,
      idle: settings.idle === undefined ? !prefersReducedMotion : settings.idle,
      destroyed: false,
      anchorsVisible: Boolean(settings.anchors),
    };

    function renderAnchorOverlay(motions, corrections) {
      if (!state.anchorsVisible || !hasAnchors) {
        if (overlay.childNodes.length > 0) overlay.replaceChildren();
        return;
      }
      const doc = svg.ownerDocument;
      const fragment = doc.createDocumentFragment();

      function mark(tag, attributes) {
        const element = doc.createElementNS(svg.namespaceURI, tag);
        for (const name of Object.keys(attributes)) {
          element.setAttribute(name, String(attributes[name]));
        }
        fragment.appendChild(element);
      }

      for (const anchor of rig.anchors) {
        const host = nodeById.get(anchor.host);
        const hostMotion = motions.get(anchor.host);
        if (!host || !hostMotion) continue;
        const hostPoint = nodePoint(
          host,
          hostMotion,
          anchor.point,
          corrections.get(anchor.host),
        );

        for (const member of anchor.members) {
          if (member.frame !== "shared") continue;
          const memberNode = nodeById.get(member.node);
          const motion = motions.get(member.node);
          if (!memberNode || !motion) continue;
          const before = nodePoint(memberNode, motion, anchor.point);
          mark("line", {
            x1: before[0],
            y1: before[1],
            x2: hostPoint[0],
            y2: hostPoint[1],
            stroke: "#ef4444",
            "stroke-width": 3,
            "stroke-dasharray": "10 8",
            "stroke-linecap": "round",
            opacity: 0.85,
          });
          mark("circle", {
            cx: before[0],
            cy: before[1],
            r: 15,
            fill: "none",
            stroke: "#ef4444",
            "stroke-width": 3,
            opacity: 0.9,
          });
        }

        mark("circle", {
          cx: hostPoint[0],
          cy: hostPoint[1],
          r: 10,
          fill: "#22c55e",
          stroke: "#052e16",
          "stroke-width": 2,
        });
      }

      overlay.replaceChildren(fragment);
    }

    function apply(cursor, time) {
      const motions = new Map();
      for (const node of rig.nodes) {
        const parallax = evaluateParallaxMotion(
          node,
          cursor,
          rig.viewBox,
          multipliers,
        );
        const idle = evaluateIdleMotion(node, time);
        motions.set(node.id, combineMotions(parallax, idle));
      }
      const corrections = resolveAnchorCorrections(rig, motions);
      for (const node of rig.nodes) {
        const element = byId.get(node.id);
        if (!element) continue;
        const transform = transformForMotion(
          node,
          motions.get(node.id),
          corrections.get(node.id),
        );
        const base = baseTransforms.get(node.id);
        element.setAttribute(
          "transform",
          base ? transform + " " + base : transform,
        );
      }
      renderAnchorOverlay(motions, corrections);
    }

    function frame(now) {
      if (state.destroyed) return;
      const dt = state.lastTime ? Math.min(now - state.lastTime, 64) : 16;
      state.lastTime = now;
      if (state.idle) {
        state.time += dt / 1000;
      }
      const easing = 1 - Math.exp(-dt / 90);
      state.current.x += (state.target.x - state.current.x) * easing;
      state.current.y += (state.target.y - state.current.y) * easing;
      apply(state.current, state.time);
      state.raf = requestAnimationFrame(frame);
    }

    stage.classList.toggle("checkerboard-dark", Boolean(settings.dark));

    apply(state.current, state.time);
    state.raf = requestAnimationFrame(frame);

    return {
      setCursor(x, y, immediate) {
        state.target.x = clamp(x, 0, 1);
        state.target.y = clamp(y, 0, 1);
        if (immediate) {
          state.current.x = state.target.x;
          state.current.y = state.target.y;
          apply(state.current, state.time);
        }
      },
      setNeutral(immediate) {
        this.setCursor(0.5, 0.5, immediate);
      },
      setDark(dark) {
        stage.classList.toggle("checkerboard-dark", Boolean(dark));
      },
      setAnchors(visible) {
        state.anchorsVisible = Boolean(visible);
        apply(state.current, state.time);
      },
      setIdle(idle) {
        state.idle = Boolean(idle);
        if (!state.idle) {
          state.time = 0;
          apply(state.current, state.time);
        }
      },
      resetClock() {
        state.time = 0;
        apply(state.current, state.time);
      },
      reset() {
        this.setCursor(0.5, 0.5, true);
        state.time = 0;
        apply(state.current, state.time);
      },
      hasAnchors() {
        return hasAnchors;
      },
      destroy() {
        state.destroyed = true;
        cancelAnimationFrame(state.raf);
        if (stage.shadowRoot) {
          stage.shadowRoot.replaceChildren();
        }
      },
    };
  }

  window.VectorParallax = {
    create: create,
    sanitizeSvg: sanitizeSvg,
    evaluateParallaxMotion: evaluateParallaxMotion,
    evaluateIdleMotion: evaluateIdleMotion,
  };
})();
