(function () {
  "use strict";

  const RATING_LABELS = { nice: "Good", fair: "Fair", bad: "Bad" };
  const RATING_CLASSES = { nice: "good", fair: "fair", bad: "bad" };
  const EDGE_SWIPE = 30;
  const SWIPE_THRESHOLD = 55;
  // Degrees of tilt that move the cursor across the full half-range. Lower is
  // more sensitive; 20° gives roughly twice the response of the original 40°.
  const GYRO_FULL_RANGE_DEGREES = 20;

  const $ = (id) => document.getElementById(id);
  const dialog = $("viewer");
  const stage = $("viewer-stage");
  const status = $("viewer-status");
  const inputThumb = $("viewer-input");
  const ratingBadge = $("viewer-rating");
  const titleNode = $("viewer-title");
  const metaNode = $("viewer-meta");
  const counterNode = $("viewer-count");
  const prevButton = $("viewer-prev");
  const nextButton = $("viewer-next");
  const tiltButton = $("viewer-tilt");
  const bgButton = $("viewer-bg");
  const hintNode = $("viewer-hint");

  let manifestPromise = null;
  let manifest = null;
  let currentIndex = -1;
  let loadToken = 0;
  let player = null;
  const assetCache = new Map();

  const finePointer = window.matchMedia("(pointer: fine)").matches;
  const coarsePointer =
    window.matchMedia("(pointer: coarse)").matches ||
    (navigator.maxTouchPoints || 0) > 0;

  let dark = Boolean(
    window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
  let dragMode = false;
  let tiltState = "unknown";
  let tiltPermission = "unknown";
  let tiltWanted = false;
  let orientationHandler = null;
  let gyroTimer = 0;
  let dragging = false;
  let pointerStart = null;
  let navGesture = false;

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function formatDate(value) {
    if (!value) return "";
    try {
      return new Date(value).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    } catch {
      return "";
    }
  }

  function getManifest() {
    if (!manifestPromise) {
      manifestPromise = fetch("./publication.json", { cache: "no-cache" })
        .then((response) => {
          if (!response.ok) {
            throw new Error(
              "Could not load publication.json (" + response.status + ")",
            );
          }
          return response.json();
        })
        .catch((error) => {
          manifestPromise = null;
          throw error;
        });
    }
    return manifestPromise.then((value) => {
      manifest = value;
      return value;
    });
  }

  function showStatus(message) {
    status.textContent = message;
    status.hidden = false;
  }

  function hideStatus() {
    status.hidden = true;
  }

  function destroyPlayer() {
    if (player) {
      player.destroy();
      player = null;
    }
  }

  function setCursorFromPointer(event) {
    if (!player) return;
    const rect = stage.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    player.setCursor(
      clamp((event.clientX - rect.left) / rect.width, 0, 1),
      clamp((event.clientY - rect.top) / rect.height, 0, 1),
    );
  }

  function updateHint() {
    if (tiltState === "gyro") {
      hintNode.textContent = "Tilt or swipe to browse";
    } else if (tiltState === "pending") {
      hintNode.textContent =
        "Tilt your phone or tap the gyroscope to turn it off";
    } else if (tiltState === "drag") {
      const canTilt =
        "DeviceOrientationEvent" in window && tiltPermission !== "denied";
      hintNode.textContent = canTilt
        ? "Drag to look · tap the gyroscope to tilt"
        : "Drag to look · swipe from an edge to browse";
    } else if (finePointer) {
      hintNode.textContent = "Move the cursor · ← → to browse";
    } else {
      hintNode.textContent = "Drag to look";
    }
  }

  function syncTiltButton() {
    if (!tiltButton) return;
    if (!coarsePointer) {
      tiltButton.hidden = true;
      return;
    }

    const supported = "DeviceOrientationEvent" in window;
    const active = tiltState === "gyro" || tiltState === "pending";
    tiltButton.hidden = false;
    tiltButton.disabled = !supported || tiltPermission === "denied";
    tiltButton.setAttribute("aria-pressed", active ? "true" : "false");

    const label = !supported
      ? "Gyroscope unavailable"
      : tiltPermission === "denied"
        ? "Gyroscope permission denied"
        : active
          ? "Turn off gyroscope control"
          : "Turn on gyroscope control";
    tiltButton.title = label;
    tiltButton.setAttribute("aria-label", label);
  }

  function syncBackgroundButton() {
    bgButton.textContent = dark ? "Light bg" : "Dark bg";
    bgButton.setAttribute("aria-pressed", dark ? "true" : "false");
  }

  function updateChrome() {
    if (!manifest || !manifest.items[currentIndex]) return;
    const item = manifest.items[currentIndex];
    ratingBadge.textContent = RATING_LABELS[item.rating] || item.rating;
    ratingBadge.className = "badge " + (RATING_CLASSES[item.rating] || "");
    titleNode.textContent = item.title;
    const details = [];
    if (item.promptVersion) details.push("Prompt " + item.promptVersion);
    if (item.model) details.push(item.model);
    if (item.createdAt) details.push(formatDate(item.createdAt));
    metaNode.textContent = details.join(" · ");
    inputThumb.src = item.assets.input;
    inputThumb.alt = "Input image for " + item.title;
    counterNode.textContent =
      currentIndex + 1 + " / " + manifest.items.length;
    prevButton.disabled = currentIndex <= 0;
    nextButton.disabled = currentIndex >= manifest.items.length - 1;
  }

  async function loadAssetPair(key, assets) {
    if (!assetCache.has(key)) {
      assetCache.set(
        key,
        Promise.all([
          fetch(assets.svg, { cache: "force-cache" }).then((response) => {
            if (!response.ok) {
              throw new Error("Could not load the SVG (" + response.status + ")");
            }
            return response.text();
          }),
          fetch(assets.rig, { cache: "force-cache" }).then((response) => {
            if (!response.ok) {
              throw new Error("Could not load the rig (" + response.status + ")");
            }
            return response.json();
          }),
        ]).then(([svg, rig]) => ({ svg, rig })),
      );
    }
    return assetCache.get(key);
  }

  async function loadAssets(item) {
    return loadAssetPair(item.id, item.assets);
  }

  async function loadCurrent() {
    if (!manifest || !manifest.items[currentIndex]) return;
    const token = ++loadToken;
    const item = manifest.items[currentIndex];
    updateChrome();
    destroyPlayer();
    showStatus("Loading interactive view…");

    try {
      const assets = await loadAssets(item);
      if (token !== loadToken || !dialog.open) return;
      player = window.VectorParallax.create(stage, assets.svg, assets.rig, {
        idle: true,
        dark: dark,
      });
      player.setCursor(0.5, 0.5, true);
      hideStatus();
    } catch (error) {
      if (token !== loadToken) return;
      showStatus("Could not load this result: " + error.message);
    }
  }

  function go(delta) {
    if (!manifest) return;
    const next = currentIndex + delta;
    if (next < 0 || next >= manifest.items.length) return;
    currentIndex = next;
    loadCurrent();
  }

  function attachOrientation() {
    if (orientationHandler) return;
    let baseBeta = null;
    let baseGamma = null;
    orientationHandler = (event) => {
      if (!player) return;
      if (typeof event.beta !== "number" && typeof event.gamma !== "number") {
        return;
      }
      const beta = typeof event.beta === "number" ? event.beta : 0;
      const gamma = typeof event.gamma === "number" ? event.gamma : 0;
      if (baseBeta === null) {
        baseBeta = beta;
        baseGamma = gamma;
      }
      player.setCursor(
        clamp(0.5 + (gamma - baseGamma) / GYRO_FULL_RANGE_DEGREES, 0, 1),
        clamp(0.5 + (beta - baseBeta) / GYRO_FULL_RANGE_DEGREES, 0, 1),
      );
      if (tiltState !== "gyro") {
        tiltState = "gyro";
        dragMode = false;
        syncTiltButton();
        updateHint();
      }
      clearTimeout(gyroTimer);
    };
    window.addEventListener("deviceorientation", orientationHandler);
  }

  function detachOrientation() {
    if (orientationHandler) {
      window.removeEventListener("deviceorientation", orientationHandler);
      orientationHandler = null;
    }
    clearTimeout(gyroTimer);
  }

  function fallBackToDrag() {
    tiltWanted = false;
    tiltState = "drag";
    dragMode = true;
    syncTiltButton();
    updateHint();
  }

  async function toggleTilt() {
    if (!("DeviceOrientationEvent" in window) || tiltPermission === "denied") {
      return;
    }

    if (tiltState === "gyro" || tiltState === "pending") {
      detachOrientation();
      tiltWanted = false;
      tiltState = "drag";
      dragMode = true;
      syncTiltButton();
      updateHint();
      return;
    }

    const constructor = window.DeviceOrientationEvent;
    if (
      typeof constructor.requestPermission === "function" &&
      tiltPermission !== "granted"
    ) {
      try {
        const permission = await constructor.requestPermission();
        if (permission !== "granted") {
          tiltPermission = "denied";
          fallBackToDrag();
          return;
        }
        tiltPermission = "granted";
      } catch {
        tiltPermission = "denied";
        fallBackToDrag();
        return;
      }
    } else {
      tiltPermission = "granted";
    }

    tiltWanted = true;
    tiltState = "pending";
    dragMode = true;
    attachOrientation();
    syncTiltButton();
    updateHint();
    clearTimeout(gyroTimer);
    gyroTimer = window.setTimeout(() => {
      if (tiltState !== "gyro") fallBackToDrag();
    }, 1600);
  }

  function setupInputMode() {
    detachOrientation();
    dragging = false;
    pointerStart = null;
    navGesture = false;

    if (!coarsePointer) {
      tiltState = "pointer";
      dragMode = false;
      syncTiltButton();
      updateHint();
      return;
    }

    if (!("DeviceOrientationEvent" in window)) {
      fallBackToDrag();
      return;
    }

    const constructor = window.DeviceOrientationEvent;
    if (typeof constructor.requestPermission === "function") {
      if (tiltPermission === "denied") {
        fallBackToDrag();
        return;
      }
      if (tiltPermission === "granted") {
        if (tiltWanted) {
          tiltState = "pending";
          dragMode = true;
          attachOrientation();
          syncTiltButton();
          updateHint();
          clearTimeout(gyroTimer);
          gyroTimer = window.setTimeout(() => {
            if (tiltState !== "gyro") fallBackToDrag();
          }, 1600);
        } else {
          tiltState = "drag";
          dragMode = true;
          syncTiltButton();
          updateHint();
        }
        return;
      }
      tiltState = "drag";
      dragMode = true;
      syncTiltButton();
      updateHint();
      return;
    }

    tiltPermission = "granted";
    if (tiltWanted) {
      tiltState = "pending";
      dragMode = true;
      attachOrientation();
      syncTiltButton();
      updateHint();
      clearTimeout(gyroTimer);
      gyroTimer = window.setTimeout(() => {
        if (tiltState !== "gyro") fallBackToDrag();
      }, 1600);
    } else {
      tiltState = "drag";
      dragMode = true;
      syncTiltButton();
      updateHint();
    }
  }

  function resetViewerSession() {
    detachOrientation();
    destroyPlayer();
    loadToken += 1;
    currentIndex = -1;
    dragMode = false;
    tiltState = "unknown";
    dragging = false;
    pointerStart = null;
    navGesture = false;
    syncTiltButton();
    hideStatus();
    document.body.classList.remove("viewer-open");
  }

  async function openViewer(index) {
    try {
      await getManifest();
    } catch (error) {
      manifest = null;
    }
    if (!dialog.open) dialog.showModal();
    resetViewerSession();
    document.body.classList.add("viewer-open");
    if (!manifest || manifest.items.length === 0) {
      titleNode.textContent = "Publication unavailable";
      metaNode.textContent = "";
      ratingBadge.textContent = "";
      inputThumb.removeAttribute("src");
      counterNode.textContent = "";
      prevButton.disabled = true;
      nextButton.disabled = true;
      showStatus("Could not load the publication manifest.");
      return;
    }
    currentIndex = clamp(Number(index) || 0, 0, manifest.items.length - 1);
    setupInputMode();
    syncBackgroundButton();
    await loadCurrent();
  }

  stage.addEventListener("pointermove", (event) => {
    if (finePointer) {
      setCursorFromPointer(event);
      return;
    }
    if (dragging && !navGesture) {
      setCursorFromPointer(event);
    }
  });

  stage.addEventListener("pointerleave", () => {
    if (finePointer && player) player.setNeutral();
  });

  stage.addEventListener("pointerdown", (event) => {
    if (finePointer) return;
    const rect = stage.getBoundingClientRect();
    const fromEdge =
      event.clientX - rect.left < EDGE_SWIPE ||
      rect.right - event.clientX < EDGE_SWIPE;
    navGesture = tiltState === "gyro" ? true : fromEdge;
    pointerStart = {
      x: event.clientX,
      y: event.clientY,
      id: event.pointerId,
      at: performance.now(),
    };
    if (!navGesture && dragMode) {
      dragging = true;
      if (stage.setPointerCapture) stage.setPointerCapture(event.pointerId);
      setCursorFromPointer(event);
    }
  });

  stage.addEventListener("pointerup", (event) => {
    if (finePointer) return;
    if (
      pointerStart &&
      navGesture &&
      pointerStart.id === event.pointerId
    ) {
      const dx = event.clientX - pointerStart.x;
      const dy = event.clientY - pointerStart.y;
      if (
        Math.abs(dx) > SWIPE_THRESHOLD &&
        Math.abs(dx) > Math.abs(dy) * 1.2
      ) {
        go(dx < 0 ? 1 : -1);
      }
    }
    dragging = false;
    pointerStart = null;
    navGesture = false;
  });

  stage.addEventListener("pointercancel", () => {
    dragging = false;
    pointerStart = null;
    navGesture = false;
  });

  document.addEventListener("click", (event) => {
    const card = event.target.closest(".result");
    if (!card) return;
    event.preventDefault();
    openViewer(Number(card.dataset.index));
  });

  prevButton.addEventListener("click", () => go(-1));
  nextButton.addEventListener("click", () => go(1));
  tiltButton.addEventListener("click", toggleTilt);
  bgButton.addEventListener("click", () => {
    dark = !dark;
    if (player) player.setDark(dark);
    syncBackgroundButton();
  });

  $("viewer-close").addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
  dialog.addEventListener("close", resetViewerSession);
  dialog.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      go(-1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      go(1);
    }
  });

  async function initFeatured() {
    const stage = $("featured-stage");
    if (!stage) return;
    try {
      const data = await getManifest();
      if (!data.featured) return;
      const assets = await loadAssetPair(
        "featured-" + data.featured.id,
        data.featured.assets,
      );
      window.VectorParallax.create(stage, assets.svg, assets.rig, {
        idle: true,
      });
      stage.dataset.ready = "true";
    } catch {
      // Leave the static fallback <img> in place.
    }
  }

  syncBackgroundButton();
  initFeatured();
})();
