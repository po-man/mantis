# Mantis

https://github.com/user-attachments/assets/62f69c9f-f39f-4cc9-8c39-caac3d353786

A lightweight, stateless microservice that turns a photo of a centered object into a
clean, layered SVG. The heavy lifting is delegated to a vision-capable model through
[OpenRouter](https://openrouter.ai); this service owns the HTTP contract, image
normalization, prompt management, SVG extraction/validation, and the deterministic
parallax rig that turns depth annotations into cursor-driven motion.

Gallery (Demo): <https://po-man.github.io/mantis/>

```
POST /v1/vectorize
  image (validate + normalize)
     │
     ▼
  OpenRouter (prompt + image)
     │
     ▼
  extract SVG (validate/sanitize + normalize)
     │
     ├─ invalid? ──► one repair retry
     ▼
  derive parallax rig from data-z
     │
     ▼
  image/svg+xml (+ rig in JSON)
```

## Requirements

- Node.js 22+
- An OpenRouter API key
- A vision-capable OpenRouter model

## Quick start

```bash
npm install
cp .env.example .env
# edit .env: set OPENROUTER_API_KEY
npm run dev
```

The service listens on `http://localhost:8080`. OpenAPI docs are at
`http://localhost:8080/docs`.

```bash
curl -sS -X POST http://localhost:8080/v1/vectorize \
  -F image=@object.png \
  -o object.svg
```

## Configuration

All configuration is environment-based. `.env` is loaded automatically when present;
real environment variables take precedence.

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `8080` | HTTP port |
| `HOST` | `0.0.0.0` | Bind address |
| `LOG_LEVEL` | `info` | `fatal`/`error`/`warn`/`info`/`debug`/`trace`/`silent` |
| `OPENROUTER_API_KEY` | — | **Required** |
| `OPENROUTER_MODEL` | `deepseek/deepseek-v4.1-flash-1017` | Vision-capable model; `particle-ai/particle-1:free` also works as a free option |
| `OPENROUTER_BASE_URL` | `https://openrouter.ai/api/v1` | Upstream base URL |
| `OPENROUTER_TEMPERATURE` | `0.2` | Sampling temperature |
| `OPENROUTER_MAX_TOKENS` | `65536` | Completion budget (SVGs are token-heavy) |
| `OPENROUTER_REASONING_EFFORT` | `low` | `none`/`minimal`/`low`/`medium`/`high`/`max`; the upstream model default is often `high`, which can spend most of the completion budget on hidden reasoning |
| `OPENROUTER_TIMEOUT_MS` | `300000` | Upstream request timeout |
| `OPENROUTER_HTTP_REFERER` | — | Optional OpenRouter attribution header |
| `OPENROUTER_APP_TITLE` | `mantis` | OpenRouter `X-Title` header |
| `OPENROUTER_PROVIDER` | — | Optional JSON provider-routing object |
| `PROMPT_VERSION` | `v015` | Prompt selector (matches `PROMPT_DIR/<version>.md` or `PROMPT_DIR/<version>-*.md`) |
| `PROMPT_DIR` | `prompts` | Directory containing versioned prompt files |
| `MAX_UPLOAD_BYTES` | `10485760` | Max upload size (10 MiB), a safety cap |
| `MAX_IMAGE_DIMENSION` | `1568` | Longest side sent upstream; larger images are downscaled |
| `MAX_CONCURRENCY` | `4` | Concurrent upstream calls |
| `MAX_QUEUE` | `32` | Max queued requests before `429` |
| `RETRY_ON_INVALID_SVG` | `1` | Repair retries after an invalid SVG |
| `REQUEST_TIMEOUT_MS` | `150000` | Fastify request timeout |
| `DATABASE_PATH` | `data/vector.db` | SQLite file for review data; use `:memory:` to disable persistence |
| `REVIEW_UI_ENABLED` | `true` | Enable the developer review UI and review API |
| `PUBLISH_ENABLED` | `true` | Allow the review UI to write local publication bundles; disable in public deployments |
| `PUBLISH_DIR` | `.publish` | Gitignored local staging directory for publication manifests and assets |

The service fails fast at boot if `OPENROUTER_API_KEY` is missing. It also fails if
`PROMPT_VERSION` matches no prompt file or more than one prompt file in `PROMPT_DIR`.

Prompt files are versioned by filename: `v001-vectorize.md` is selected with
`PROMPT_VERSION=v001`, and `v015-clipped-catchlight.md` with `PROMPT_VERSION=v015`
(the default). v015 keeps the lean idle-motion contract introduced in v014 —
deduplicated rules, no mandatory `<reasoning>` plan — derives `data-z` from observed
occlusion instead of a part-type table, and clips eye catchlights inside the eyeball
mask. The prompt also defines the closed idle-motion vocabulary (`data-anim`) and the
blink mask contract: each eye is a self-contained masked group that the rig can close
by scaling vertically.

## API

### `POST /v1/vectorize`

Accepts either:

- `multipart/form-data` with a file field named `image` (PNG, JPEG, or WebP), or
- `application/json` with `{ "image": "data:image/png;base64,..." }` (a bare base64
  string also works).

Query parameters:

| Name | Values | Description |
| --- | --- | --- |
| `format` | `svg` (default), `json` | Response format |

`Accept: application/json` also selects the JSON response when `format` is omitted.

**SVG response** (`image/svg+xml`):

```
Content-Type: image/svg+xml; charset=utf-8
Content-Disposition: inline; filename="vector.svg"
X-Request-Id: f47ac10b-58cc-4372-a567-0e02b2c3d479
X-Model: deepseek/deepseek-v4.1-flash-1017
X-Prompt-Version: 62966b3d919e
```

Parser and rig warnings are not exposed as response headers; request the JSON
response (`?format=json`) to read the `warnings` array.

**JSON response**:

```json
{
  "svg": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 1024 1024\" ...>...</svg>",
  "rig": {
    "format": "vector.parallax",
    "version": 2,
    "viewBox": [0, 0, 1024, 1024],
    "cursor": { "space": "normalized", "neutral": [0.5, 0.5] },
    "defaults": {
      "shift": 40,
      "scale": 0.06,
      "rotate": 1.5,
      "proximity": 0.55,
      "direction": "inverse",
      "neutralZ": 0.5
    },
    "nodes": [
      {
        "id": "head",
        "tag": "g",
        "z": 0.62,
        "parentZ": 0.5,
        "depth": 0.12,
        "pivot": [650, 450],
        "gain": 1,
        "weld": 1,
        "baseTransform": null,
        "translate": {
          "x": { "const": 0, "cx": -4.8, "cy": 0 },
          "y": { "const": 0, "cx": 0, "cy": -4.8 }
        },
        "scale": {
          "const": 1,
          "cx": 0,
          "cy": 0,
          "proximity": 0.0144,
          "radius": 0.55,
          "neutral": 0.9646
        },
        "rotate": { "const": 0, "cx": 0, "cy": 0 }
      }
    ],
    "anchors": [
      {
        "id": "neck",
        "host": "torso",
        "point": [650, 620],
        "members": [{ "node": "head", "frame": "shared" }]
      }
    ],
    "synthetic": false,
    "warnings": []
  },
  "model": "deepseek/deepseek-v4.1-flash-1017",
  "usage": {
    "promptTokens": 1234,
    "completionTokens": 5678,
    "totalTokens": 6912,
    "cachedTokens": 1024,
    "reasoningTokens": 0,
    "costUsd": 0.003112
  },
  "warnings": [],
  "requestId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "attempts": 1,
  "promptVersion": "62966b3d919e"
}
```

The SVG response carries the same rig metadata only as an `X-Rig-Nodes` count; the
rig itself is available in the JSON response and as a `.rig.json` sidecar in batch runs.

### Parallax rig

The SVG stays completely static. Depth is authored by the model through
`data-z="0…1"` attributes, and `deriveParallaxRig()` converts those annotations into
explicit cursor-driven functions for every animated element. Optional `data-anim`
metadata adds a second, time-driven idle motion that is independent of the cursor.

| Attribute | Meaning |
| --- | --- |
| `data-z` | Absolute depth: `0` far, `0.5` neutral, `1` near. Required on animated elements. |
| `data-pivot` | `"x,y"` pivot for scale/rotation, in the parent's coordinate space. |
| `data-parallax` | Optional motion gain multiplier (default `1`). |
| `data-sockets` | Host-side joint declarations: `"name:x,y name:x,y"` in root coordinates. |
| `data-anchor` | Child-side weld: a space-separated list of socket names. |
| `data-weld` | Optional weld strength `0…1` (default `1`); below `1` leaves a hint of independent slide. |
| `data-anim` | Optional idle-motion preset: `breathe`, `bob`, `sway`, `blink`, `nod`, `twitch`, `wave`, or `hop`. |
| `data-anim-period` | Optional idle period in seconds (default from the preset). |
| `data-anim-amplitude` | Optional idle amplitude in the preset's unit (scale fraction, degrees, or viewBox units). |
| `data-anim-delay` | Optional idle phase delay in seconds. |
| `clip-path` | Put silhouette clips on the parent `<g>`, not on highlight primitives, so highlights can slide inside the mask. |

The rig is read in a normalized cursor space, with `(0.5, 0.5)` at rest. For a node,
with `cx = (u - 0.5) * 2` and `cy = (v - 0.5) * 2`:

```text
px = (pivot.x - viewBox.x) / viewBox.width
py = (pivot.y - viewBox.y) / viewBox.height

tx = x.const + x.cx*cx + x.cy*cy
ty = y.const + y.cx*cx + y.cy*cy

dist = hypot(u - px, v - py) / sqrt(2)
proximity = exp(-(dist / scale.radius)^2) - scale.neutral
s = scale.const + scale.cx*cx + scale.cy*cy + scale.proximity*proximity

r = rotate.const

transform =
  translate(tx, ty)
  translate(pivot.x, pivot.y) rotate(r) scale(s)
  translate(-pivot.x, -pivot.y)
```

Cursor-driven in-plane rotation is intentionally disabled. The old
`rotate.cx*cx + rotate.cy*cy` dipole made one diagonal rotate while the opposite
diagonal stayed upright, so the four corners did not feel like equivalent
viewpoints. A purely linear rotation field cannot be nonzero and equal at all four
corners, and a flat illustration has no need to roll in-plane as the viewpoint
moves. Older rigs may still contain legacy `rotate.cx`/`rotate.cy` coefficients;
the evaluator ignores them. Idle `data-anim` rotation is separate and still works.

`depth` is stored relative to the nearest animated ancestor, so nested transforms
compose to the absolute depth `z`. `scale.neutral` is the proximity value at rest;
subtracting it makes the neutral cursor exactly identity. An existing
`baseTransform` is appended after the parallax transform.

#### Joint welds

Free-floating depth translation makes adjacent top-level parts drift apart. A
`data-anchor` welds a part's joint onto a socket declared by another part, so the
connection survives cursor motion:

```xml
<g id="torso" data-z="0.32" data-pivot="500,480"
   data-sockets="neck:760,560 shoulder-left:560,470">…</g>
<g id="head" data-z="0.55" data-anchor="neck">…</g>
<g id="arm" data-z="0.70" data-pivot="560,470"
   data-anchor="shoulder-left">…</g>
```

- Coordinates are root-space `x,y`; an anchored part's pivot defaults to its socket
  point, so its depth motion becomes a swing about the joint.
- All Level-1 parts should be siblings under one root wrapper. When host and member
  share a parent frame the weld is `shared`; when the host is the member's nearest
  animated ancestor the weld is `local` and only the relative translation is cancelled.
- At runtime each member's joint is moved onto the host's joint:

```text
A(node, q) = pivot + t + s * R(r) * (q - pivot)
delta      = A(host, q) + hostCorrection - A(member, q)
member.tx += delta.x * weld
member.ty += delta.y * weld
```

`resolveAnchorCorrections()` resolves hosts first, so multi-hop chains stay welded.
A node with several sockets receives the average delta. The review preview mirrors
this function and offers an **Anchors** toggle that draws each welded joint and the
member's pre-weld position.

The derivation also:

- injects stable ids for animated elements that lack one;
- wraps a clipped highlight primitive in a static `<g clip-path="…">` so the
  primitive can move inside its mask (a group's own clip is left in place);
- emits warnings for out-of-range depths, duplicate ids, non-ascending paint order,
  a depth spread below `0.35`, unknown/duplicate sockets, anchor cycles, and anchor
  nodes that cross animated frames;
- parses `data-anim` into idle tracks and warns about unknown presets, blink targets
  without a clip, translating presets on anchored parts, and more than four idle
  elements;
- falls back to synthetic paint-order depth for older SVGs without `data-z`, so
  existing v005 conversions remain interactive. The fallback is marked with
  `"synthetic": true` and intentionally does not warn.

#### Idle motion (view-point-independent)

`data-anim` adds a second, time-driven motion that is independent of the cursor.
The final transform is the composition of both motions:

```text
parallax = evaluateParallaxNode(node, cursor, viewBox, multipliers)
idle     = evaluateIdleNode(node, time)
motion   = {
  tx: parallax.tx + idle.tx,
  ty: parallax.ty + idle.ty,
  scaleX: parallax.scale * idle.scaleX,
  scaleY: parallax.scale * idle.scaleY,
  rotate: parallax.rotate + idle.rotate,
}
```

With the cursor centred, the parallax term is identity and the idle motion still
runs. Moving the cursor adds the parallax on top. The rig stores the resolved
oscillators in each node's `idle` field, so the animation is deterministic and
self-contained. Rigs with idle tracks use `version: 3`.

The preset vocabulary is closed:

| Preset | Target | Channel | Default | Period | Waveform |
| --- | --- | --- | --- | --- | --- |
| `breathe` | torso / body | uniform scale | 2% | 4 s | sine |
| `bob` | root / head / object | translate Y | 6 units | 3 s | sine |
| `sway` | tail / hair / antenna | rotate | 3° | 3.5 s | sine |
| `blink` | eye group | scale Y | 0.9 close | 4.5 s | pulse |
| `nod` | head | rotate | 2.5° | 4 s | sine |
| `twitch` | ear / whisker / brow | rotate | 3° | 5 s | damped pulse |
| `wave` | arm / hand / paw | rotate | 8° | 2 s | sine |
| `hop` | small subject root | translate Y + squash | 12 units | 3 s | bounce |

```xml
<g id="subject" data-z="0.5" data-pivot="512,512"
   data-anim="bob" data-anim-amplitude="6">
  <g id="body" data-z="0.35" data-pivot="500,500" data-anim="breathe">…</g>
  <g id="head" data-z="0.55" data-anchor="neck" data-anim="nod">…</g>
  <g id="left-eye" data-z="0.62" data-pivot="420,430"
     data-anim="blink" clip-path="url(#clip-left-eye)">…</g>
</g>
```

Blink is implemented by scaling the **masked eye group** vertically around its
pivot. The prompt requires each eye to be a self-contained blink target whose
aperture clip, iris/pupil, catchlights, and lash mass all live inside the group;
no skin-coloured eyelid primitive is needed. The rig warns when a `blink` target
has no clip in its subtree or does not look like an eye group.

Anchored parts may only use rotation/scale presets (`breathe`, `sway`, `nod`,
`twitch`, `wave`, `blink`). `bob` and `hop` translate, so the joint weld would
cancel them; the rig emits a warning when that combination appears. Only the
root or an unanchored part should translate.

The review preview adds an **Idle** toggle. Idle is on by default unless the
browser reports `prefers-reduced-motion: reduce`; **Reset** returns the clock to
zero.

### Lash silhouettes

A constant `stroke-width` cannot taper, so v011 requires lashes to be **closed,
tapered filled paths** (`stroke="none"`) instead of stroked arcs. The prompt offers
six archetypes — Solid Wing, Tapered Spikes, Serrated Fringe, Mask Notch, Feather
Lobe, and Soft Comb — and asks the model to start the lash on the outer half of the
lid, protrude a sharp tip 6–14 units past the outer silhouette, taper monotonically
to a 0–2 unit point, stay under 55 % of the eye width, mirror with 10–20 %
asymmetry, and pick a fill tone that contrasts with the immediate background. Lashes
stay outside the eye clip, sit directly under the eye group (or a `left-lashes`
wrapper), carry stable `left-lash`/`right-lash` ids, and inherit the eye's `data-z`
(or `+0.00–0.03`) so they travel with the eyelid.

`parseSvg()` lints the result and emits warnings when an element whose id contains
`lash`:

- has `fill="none"` or a non-`none` `stroke` (uniform-arc regression);
- is a `<line>` or `<polyline>` rather than a fillable path;
- sits inside a clipped ancestor;
- is nested in a glint/gloss/glaze/highlight subgroup instead of the eye group.

### Errors

All errors use one envelope:

```json
{
  "error": {
    "code": "invalid_svg",
    "message": "The model did not return a valid SVG after 2 attempt(s): no_svg_found",
    "requestId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    "details": { "code": "no_svg_found", "attempts": 2, "finishReason": "stop" }
  }
}
```

| Status | Code | Meaning |
| --- | --- | --- |
| `400` | `bad_request` | Missing/invalid input |
| `413` | `payload_too_large` | Upload exceeds `MAX_UPLOAD_BYTES` |
| `415` | `unsupported_media_type` | Not PNG/JPEG/WebP |
| `422` | `invalid_svg` | No valid SVG after repair attempts |
| `429` | `rate_limited` | Queue full or upstream rate limit |
| `502` | `upstream_error` | OpenRouter failure |
| `504` | `upstream_timeout` | OpenRouter timeout |
| `500` | `config_error` / `internal_error` | Misconfiguration or unexpected failure |

### Ops

- `GET /healthz` — liveness
- `GET /readyz` — readiness (model + prompt version)
- `GET /docs` — Swagger UI
- `GET /review` — developer review UI (when `REVIEW_UI_ENABLED=true`)

## Development

```bash
npm run dev        # tsx watch
npm run typecheck  # tsc --noEmit
npm test           # vitest
npm run build      # compile to dist/
npm start          # run the compiled service
```

Tests mock the upstream client; no live OpenRouter calls are made.

## Batch runs

`samples/inputs/` holds a small, committed dataset. `scripts/batch-vectorize.ts`
submits it to a running service through `POST /v1/vectorize?format=json` with a
pool of independent workers: each worker claims the next sample as soon as its own
job finishes, so no worker waits for the others.

```bash
npm run dev   # in another terminal

npm run batch -- --label v006-smoke
npm run batch -- --workers 8 --filter "animals/*.png" --label animals
npm run batch -- --dry-run          # list samples without calling the API
```

| Option | Default | Description |
| --- | --- | --- |
| `--workers` | `4` | Concurrent workers (match the server `MAX_CONCURRENCY`) |
| `--base-url` | `http://localhost:8080` | Service origin, or `VECTOR_BASE_URL` |
| `--inputs` | `samples/inputs` | Sample root |
| `--out` | `samples/outputs` | Output root |
| `--label` | — | Suffix for the run directory |
| `--filter` | — | Glob on basename or relative path |
| `--retries` | `2` | Retries for `429`/`502`/`503`/`504`/network only |
| `--timeout` | `300000` | Per-request timeout in ms |
| `--strict` | off | Reject names not matching `{index}-{slug}.{ext}` |
| `--dry-run` | off | Print the queue without calling the API |
| `--quiet` | off | Suppress per-sample success lines (failures still print) |
| `--fail-fast` | off | Stop claiming new samples after the first failure |

Each run writes `samples/outputs/<run-id>/` with one `.svg`, one `.rig.json`
parallax rig, and a `.json` sidecar per input, plus a `run.json` manifest containing
the server model, prompt version, timings, per-sample results, and aggregate token
usage. See [`samples/README.md`](samples/README.md) for the naming convention.

## Notes and limitations

- Stateful review data is stored in local SQLite; there is still no caching or job
  queue for conversions.
- No authentication; deploy behind a trusted network boundary or add a gateway, and
  disable or protect the review UI in public deployments.
- `node:sqlite` is still marked experimental in Node 22 and emits a warning at startup.
  It avoids native dependencies; switch to `better-sqlite3` if you need a stable driver
  API.
- The service sanitizes SVG output, but you should still serve untrusted SVGs with a
  restrictive CSP (the service sets one on its own responses).
- Image inputs are downscaled to `MAX_IMAGE_DIMENSION` (default **1568 px on the
  longest side**) before the VLM call. 1568 is a common vision-model sweet spot: it
  preserves enough detail for edge tracing while keeping image tokens low. The
  `MAX_UPLOAD_BYTES` limit is a separate safety cap on the raw upload.
- The model is responsible for mapping the subject onto the 1024×1024 canvas.
