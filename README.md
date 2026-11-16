# vector

A lightweight, stateless microservice that turns a photo of a centered object into a
clean, layered SVG. The heavy lifting is delegated to a vision-capable model through
[OpenRouter](https://openrouter.ai); this service owns the HTTP contract, image
normalization, prompt management, SVG extraction/validation, and the deterministic
parallax rig that turns depth annotations into cursor-driven motion.

```
POST /v1/vectorize
  image ──► validate + normalize ──► OpenRouter (prompt + image)
                                          │
                                          ▼
                                extract SVG ──► validate/sanitize ──► normalize
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
# edit .env: set OPENROUTER_API_KEY and OPENROUTER_MODEL
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
| `OPENROUTER_MODEL` | — | **Required**, e.g. `google/gemini-2.5-flash` |
| `OPENROUTER_BASE_URL` | `https://openrouter.ai/api/v1` | Upstream base URL |
| `OPENROUTER_TEMPERATURE` | `0.2` | Sampling temperature |
| `OPENROUTER_MAX_TOKENS` | `16384` | Completion budget (SVGs are token-heavy) |
| `OPENROUTER_REASONING_EFFORT` | — | `none`/`minimal`/`low`/`medium`/`high`/`max`; unset keeps the model default (often `high`, which can spend most of the completion budget on hidden reasoning) |
| `OPENROUTER_TIMEOUT_MS` | `120000` | Upstream request timeout |
| `OPENROUTER_HTTP_REFERER` | — | Optional OpenRouter attribution header |
| `OPENROUTER_APP_TITLE` | `vector` | OpenRouter `X-Title` header |
| `OPENROUTER_PROVIDER` | — | Optional JSON provider-routing object |
| `PROMPT_VERSION` | — | **Required**, prompt selector, e.g. `v001` (matches `PROMPT_DIR/<version>.md` or `PROMPT_DIR/<version>-*.md`) |
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

The service fails fast at boot if required configuration is missing. It also fails if
`PROMPT_VERSION` matches no prompt file or more than one prompt file in `PROMPT_DIR`.

Prompt files are versioned by filename: `v001-vectorize.md` is selected with
`PROMPT_VERSION=v001`, `v002-rig-ready-flat-vectoriser.md` with `PROMPT_VERSION=v002`,
and `v013-idle-motion.md` with `PROMPT_VERSION=v013`. v013 builds on v012's
depth-annotated Level-1 joint sockets/anchors, filled tapered lash silhouettes, and
pose-faithful eye construction, and adds a closed idle-motion vocabulary
(`data-anim`) plus the blink mask contract: each eye is a self-contained masked
group that the rig can close by scaling vertically. v014 is the same contract written
lean: deduplicated rules, no mandatory `<reasoning>` plan, and about 61% fewer prompt
characters (33 KB → 12.8 KB, roughly 8.8k → 3.9k prompt tokens). v015 keeps v014's
lean contract but derives `data-z` from observed occlusion instead of a part-type
table, and clips eye catchlights inside the eyeball mask.

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
X-Model: google/gemini-2.5-flash
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
  "model": "google/gemini-2.5-flash",
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
rig itself is available in the JSON response, from the review API, and as a
`.rig.json` sidecar in batch runs.

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
| `403` | `forbidden` | Cross-origin publication write rejected |
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

## Conversion review data

Every conversion is recorded in a local SQLite database (`DATABASE_PATH`). The service
stores:

- the normalized image actually sent to the model (the downsampled image when the
  original exceeded `MAX_IMAGE_DIMENSION`);
- the successful SVG output, its size, element/path counts, and parser warnings;
- total request latency, upstream latency, attempts, token usage, and per-attempt LLM
  metrics;
- billed cost, prompt-cache hits and reasoning tokens per attempt;
- failed conversions with their error code/message.

Prompt text is stored once in a separate `prompts` table keyed by the prompt content
hash (`version`). Conversions reference that row, so changing the prompt creates a new
prompt version without duplicating the old prompt for every request. Historical
conversions keep pointing at the exact prompt they used.

The review UI at `http://localhost:8080/review` provides:

- summary cards and per-prompt-version statistics;
- filtering by status, publication rating, model, prompt version, and request ID;
- **Nice / Fair / Bad** publication ratings on each successful conversion, both in
  the table and in the detail view;
- a separate **featured** pick (the star beside the ratings) for the idle-only hero
  at the top of the published page;
- a paginated conversion table with input thumbnails;
- a publication export dialog that writes a curated bundle to `.publish/`;
- a detail view with the input image, rendered SVG, an interactive parallax preview,
  the derived rig JSON, prompt text, warnings, raw SVG, and per-attempt LLM metrics.

The parallax preview replaces the static SVG output in the detail view and uses a
checkerboard background; a **Dark bg/Light bg** button toggles the checkerboard shade.
It injects the SVG into a shadow root, tracks the pointer in normalized cursor space,
and applies each rig node's transform on an animation frame. Motion is fixed at the
strongest setting; **Play** runs a demo path and **Reset** returns the cursor and the
idle clock to neutral. **Idle** toggles the view-point-independent `data-anim` motion
(on by default unless `prefers-reduced-motion: reduce` is set). **Anchors** overlays
each welded joint (green dot), the member's pre-weld position (red ring), and the
correction the weld applies. Older conversions without a stored rig are normalized
and given synthetic paint-order depth on demand. The published site uses the same
`public/parallax-player.js` module, so review and publication share one evaluator.

### Cost telemetry

Requests carry `usage: { "include": true }`, so OpenRouter reports the billed cost in
USD and the prompt-cache statistics for every call. The service stores
`cost_usd`, `cached_tokens` and `reasoning_tokens` next to the token counts, and
`GET /review/api/stats` exposes:

| Field | Meaning |
| --- | --- |
| `totalCostUsd` / `avgCostUsd` | Billed cost overall and per conversion |
| `costedConversions` | Rows that reported a cost; older rows predate the feature |
| `totalCachedTokens` / `cacheHitRate` | Prompt tokens served from the provider cache, and their share of all prompt tokens |
| `totalReasoningTokens` | Reasoning tokens, a subset of completion tokens |

Per-prompt-version statistics also carry `totalCostUsd` and `avgCostUsd`, so prompt
variants can be compared on cost, not just tokens. Historical rows have no cost and
are excluded from the averages rather than counted as free, which is why
`costedConversions` is reported separately. Cost is whatever OpenRouter returns; it
is `null` when the upstream provider does not report usage accounting.

Review endpoints:

| Route | Description |
| --- | --- |
| `GET /review/api/conversions` | Paginated list (`limit`, `offset`, `status`, `rating`, `model`, `promptVersion`, `q`) |
| `GET /review/api/conversions/:id` | Metadata, prompt text, warnings, LLM calls, rating, and the parallax rig |
| `PUT /review/api/conversions/:id/selection` | Set or clear a `nice`/`fair`/`bad` publication rating |
| `PUT /review/api/publication/featured` | Set or clear the single featured conversion |
| `GET /review/api/conversions/:id/input` | Stored input image |
| `GET /review/api/conversions/:id/output.svg` | Stored SVG output |
| `GET /review/api/conversions/:id/parallax.svg` | SVG normalized for the rig (ids + clip wrappers) |
| `GET /review/api/conversions/:id/rig.json` | Stored or on-demand parallax rig |
| `GET /review/api/publication` | Local staging metadata, selection counts, and featured pick |
| `POST /review/api/publish` | Write the local `.publish/` manifest and assets |
| `GET /review/api/stats` | Aggregate and per-prompt statistics |

> The review UI and API are unauthenticated. Use it on a trusted network, bind the
> service to localhost, or protect `/review` behind a gateway. Set
> `REVIEW_UI_ENABLED=false` in public deployments.

SQLite storage is synchronous and runs in-process. A failed write is logged but does
not fail the conversion request. The database grows with stored images and SVGs; add
external retention/cleanup if you keep the service running for a long time.

## Publishing selected results

The local review UI curates results into a static GitHub Pages site. Assets are never
committed to the current branch: the export writes a gitignored staging bundle, and a
separate `publish.*` branch carries the committed files.

### 1. Curate and write the staging bundle

1. Open `http://localhost:8080/review`.
2. Mark successful conversions **Nice**, **Fair**, or **Bad**. A rating is the
   selection; clicking the active rating clears it.
3. Optionally click the **star** beside the ratings to pick one conversion for the
   idle-only hero at the top of the page. The featured pick is independent of the
   rating and can be unrated.
4. Click **Publish**, review the counts and edit the intro (must be under 100 words),
   then click **Write bundle**.

The service writes:

```
.publish/
├── selections.json
└── assets/
    ├── 0001-<id>-input.png
    ├── 0001-<id>.svg
    ├── 0001-<id>.rig.json
    ├── featured-<id>.svg
    └── featured-<id>.rig.json
```

`.publish/` is gitignored and can be regenerated at any time. The manifest has this
shape:

```json
{
  "format": "vector.publication",
  "version": 1,
  "title": "vector · selected results",
  "intro": "vector is a small image-to-SVG service...",
  "generatedAt": "2026-11-16T...",
  "items": [
    {
      "id": 42,
      "rating": "nice",
      "title": "Conversion #42",
      "model": "google/gemini-2.5-flash",
      "promptVersion": "v015",
      "createdAt": 1760000000000,
      "assets": {
        "input": "assets/0001-42-input.png",
        "svg": "assets/0001-42.svg",
        "rig": "assets/0001-42.rig.json"
      }
    }
  ],
  "featured": {
    "id": 7,
    "rating": "nice",
    "title": "Conversion #7",
    "model": "google/gemini-2.5-flash",
    "promptVersion": "v015",
    "createdAt": 1760000000000,
    "assets": {
      "svg": "assets/featured-7.svg",
      "rig": "assets/featured-7.rig.json"
    }
  }
}
```

Ratings are stored as `nice`, `fair`, and `bad`; the published page labels the Nice
tier **Good**. Historical conversions without a stored rig are normalized and given a
rig on export. The export fails rather than publishing a partial item when an input,
SVG, or rig is missing.

The optional `featured` object is the single star pick. It has no input asset and is
excluded from the Good/Fair/Bad galleries, so it appears only in the idle-only hero.
`featured.rating` may be `null` when the pick is unrated. A publication may contain
only a featured pick and no gallery items.

### 2. Create the publish branch

```bash
npm run publish:branch -- --name publish.2026-11-16
```

The script:

- validates `.publish/selections.json` and every asset;
- refuses to run on a detached HEAD or with tracked uncommitted changes;
- creates `publish.2026-11-16` from the **current branch's HEAD** in a temporary
  worktree;
- copies `.publish/` to `publish/` on that branch and commits it;
- creates tag `publish.2026-11-16` on the same commit;
- removes the temporary worktree.

The current branch, index, and working tree are untouched. The generated branch
contains the bundle commit; the tag is the durable deploy reference. If you only want
a branch trigger, pass `--no-tag`.

Manual equivalent:

```bash
git switch -c publish.2026-11-16
mkdir -p publish && cp -R .publish/. publish/
git add publish
git commit -m "publish: publish.2026-11-16"
git tag publish.2026-11-16
git switch -
```

Do not merge `publish.*` into the source branch.

### 3. Push the release

```bash
git push origin refs/heads/publish.2026-11-16:refs/heads/publish.2026-11-16
git push origin refs/tags/publish.2026-11-16:refs/tags/publish.2026-11-16
```

The tag push triggers `.github/workflows/publish.yml`, which runs
`npm run publish:build` against the tag commit and deploys `site/` to GitHub Pages.
Because the branch and tag share a name, the explicit `refs/...` forms avoid
ambiguity.

After a successful deployment the branch can be deleted; the tag still preserves the
exact bundle:

```bash
git push origin --delete publish.2026-11-16
git branch -D publish.2026-11-16
```

### 4. Preview locally

```bash
npm run publish:build -- --manifest .publish/selections.json --out site
python3 -m http.server 4173 -d site
```

Open `http://localhost:4173`. If a featured conversion is selected, the page starts
with its idle-only SVG: on desktop it sits to the right of the intro text, and on
mobile it appears above the title and intro. The hero has no input image, modal,
cursor, tilt, or swipe interaction. Below it are three stacked **Good / Fair / Bad**
galleries. Each card shows the input image and static SVG side by side on desktop and
stacked on mobile. Clicking or tapping a card opens a modal:

- idle motion is always on;
- the SVG moves in 2.5D from the cursor on desktop;
- mobile uses the gyroscope, with an **Enable tilt** gesture for iOS, or drag fallback;
- arrow keys navigate on desktop; swipe navigates on mobile (from the screen edge when
  drag fallback is active);
- a light/dark checkerboard toggle is available;
- the input image stays visible as a small thumbnail.

### GitHub Pages setup

Set **Settings → Pages → Build and deployment → Source** to **GitHub Actions** once.
For this repository the site is `https://po-man.github.io/mantis/`. All asset URLs are
relative, so a custom domain or project subpath works without rebuilding.

> The publish endpoint writes files and is protected only by the same local-only trust
> model as the review UI. Keep `REVIEW_UI_ENABLED`/`PUBLISH_ENABLED` off on public
> deployments. The endpoint accepts JSON and rejects cross-origin writes.

## How the SVG parser works

The prompt asks the model for the complete SVG in a fenced `xml` block (some prompt
versions also encourage a short `<reasoning>` preamble). The parser does not trust
that contract:

1. Normalize the response (BOM, line endings, whitespace).
2. Collect fenced blocks containing `<svg>`; fall back to the raw slice from the
   first `<svg>` to the last `</svg>`.
3. Prefer the longest well-formed candidate; otherwise use the longest candidate and
   repair it leniently.
4. Parse strictly with `saxes`, then leniently with `cheerio` (`xmlMode`).
5. Sanitize:
   - remove `<script>`, `<foreignObject>`, `<iframe>`, `<object>`, `<embed>`,
     animation elements, and raster `<image>` embeds;
   - remove `on*` handlers, `src`, external `href`/`xlink:href`, `javascript:` URLs,
     and external `url(...)` references;
   - remove stylesheets containing `@import`, `expression()`, or external URLs.
6. Normalize the root: ensure `xmlns`, `viewBox="0 0 1024 1024"` (added if missing),
   `width="100%"`, `height="100%"`; strip comments and `<metadata>`.
7. Reject documents with no drawable elements.
8. On failure, retry once with a repair message. If the model hit its token limit,
   the retry doubles `max_tokens` (capped at 32768).

After parsing, the service calls `deriveParallaxRig()`. That step may inject stable
ids for animated elements, wrap clipped highlight primitives in a static `<g>`, and
serialize the SVG again. The stored/downloadable SVG is the normalized result, so it
is visually identical to the model output but may contain extra attributes and
wrapper groups; the rig references those ids.

## Project layout

```
.
├── .github/
│   └── workflows/
│       └── publish.yml       # tag-triggered GitHub Pages deployment
├── prompts/
│   ├── v001-vectorize.md     # default geometric-fidelity prompt
│   ├── v002-rig-ready-flat-vectoriser.md
│   ├── v006-parallax-depth-vectorizer.md
│   ├── v010-rig-joints.md    # parallax depth + Level-1 joint welds
│   ├── v011-lash-silhouette.md # v010 + filled tapered lashes
│   ├── v012-pose-faithful-eyes.md # v011 + pose-faithful eyes
│   ├── v013-idle-motion.md   # v012 + idle-motion presets + blink mask contract
│   ├── v014-lean-idle-motion.md # v013 contract, deduplicated and shortened
│   └── v015-clipped-catchlight.md # v014 + occlusion-derived z + clipped catchlights
├── public/
│   ├── review.html           # dependency-free review UI
│   ├── parallax-player.js    # shared review/published-site player
│   ├── publish-site.html     # static publication template
│   ├── publish.css           # publication page styles
│   └── publish.js            # publication modal, navigation, tilt/drag/swipe
├── samples/
│   ├── inputs/               # committed sample images, grouped by subject
│   └── outputs/              # generated runs (gitignored)
├── scripts/
│   ├── batch-vectorize.ts    # concurrent batch driver for POST /v1/vectorize
│   ├── build-site.ts         # validate bundle + generate site/
│   └── publish-branch.ts     # create a publish.* branch in a temp worktree
├── src/
│   ├── index.ts              # bootstrap + graceful shutdown
│   ├── app.ts                # Fastify factory (injectable for tests)
│   ├── config.ts             # env schema + typed config
│   ├── routes/
│   │   ├── vectorize.ts      # HTTP contract + persistence
│   │   └── review.ts         # review UI + review/publication API
│   ├── services/
│   │   ├── openrouter.ts     # upstream client
│   │   ├── prompt.ts         # prompt loading + version hash
│   │   ├── image.ts          # magic-byte validation + normalization
│   │   ├── parallax.ts       # data-z → cursor-driven motion rig
│   │   ├── publication-manifest.ts # manifest schema + defaults
│   │   ├── publication.ts    # local bundle writer
│   │   ├── svg-parser.ts     # extraction, validation, sanitization
│   │   ├── store.ts          # SQLite persistence + queries
│   │   └── vectorize.ts      # orchestration + repair retry
│   └── lib/
│       ├── errors.ts
│       ├── logger.ts
│       ├── semaphore.ts
│       └── text.ts
└── test/
    ├── fixtures/
    │   └── responses/        # parser fixtures
    ├── store.test.ts
    ├── svg-parser.test.ts
    └── vectorize.test.ts
```

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

## Docker

```bash
docker build -t vector .
docker run --rm -p 8080:8080 \
  -e OPENROUTER_API_KEY=... \
  -e OPENROUTER_MODEL=google/gemini-2.5-flash \
  -e PROMPT_VERSION=v001 \
  -v vector-data:/app/data \
  -v "$PWD/.publish:/app/.publish" \
  vector
```

The image stores SQLite data in `/app/data` by default. Mount a volume there to keep
review data across container restarts. Mount `./.publish` when you want the review UI
inside the container to write publication bundles into the host repository.

## Notes and limitations

- Stateful review data is stored in local SQLite; there is still no caching or job
  queue for conversions.
- Publication assets live only on generated `publish.*` branches/tags, never on the
  source branch. Each publication adds a commit and tag; prune old publication
  branches if you do not need to inspect them.
- No authentication; deploy behind a trusted network boundary or add a gateway, and
  disable or protect the review UI and publication endpoint in public deployments.
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
