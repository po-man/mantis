# vector

A lightweight, stateless microservice that turns a photo of a centered object into a
clean, layered SVG. The heavy lifting is delegated to a vision-capable model through
[OpenRouter](https://openrouter.ai); this service owns the HTTP contract, image
normalization, prompt management, and SVG extraction/validation.

```
POST /v1/vectorize
  image ──► validate + normalize ──► OpenRouter (prompt + image)
                                          │
                                          ▼
                                extract SVG ──► validate/sanitize ──► normalize
                                          │
                                          └─ invalid? ──► one repair retry
                                          ▼
                                    image/svg+xml
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
| `OPENROUTER_TIMEOUT_MS` | `120000` | Upstream request timeout |
| `OPENROUTER_HTTP_REFERER` | — | Optional OpenRouter attribution header |
| `OPENROUTER_APP_TITLE` | `vector` | OpenRouter `X-Title` header |
| `OPENROUTER_PROVIDER` | — | Optional JSON provider-routing object |
| `PROMPT_PATH` | `prompts/vectorize.md` | System prompt file |
| `MAX_UPLOAD_BYTES` | `10485760` | Max upload size (10 MiB), a safety cap |
| `MAX_IMAGE_DIMENSION` | `1568` | Longest side sent upstream; larger images are downscaled |
| `MAX_CONCURRENCY` | `4` | Concurrent upstream calls |
| `MAX_QUEUE` | `32` | Max queued requests before `429` |
| `RETRY_ON_INVALID_SVG` | `1` | Repair retries after an invalid SVG |
| `REQUEST_TIMEOUT_MS` | `150000` | Fastify request timeout |

The service fails fast at boot if required configuration is missing.

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
X-Request-Id: req-1
X-Model: google/gemini-2.5-flash
X-Prompt-Version: 62966b3d919e
X-Svg-Warnings: removed raster <image> element
```

**JSON response**:

```json
{
  "svg": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 1024 1024\" ...>...</svg>",
  "model": "google/gemini-2.5-flash",
  "usage": { "promptTokens": 1234, "completionTokens": 5678, "totalTokens": 6912 },
  "warnings": [],
  "requestId": "req-1",
  "attempts": 1,
  "promptVersion": "62966b3d919e"
}
```

### Errors

All errors use one envelope:

```json
{
  "error": {
    "code": "invalid_svg",
    "message": "The model did not return a valid SVG after 2 attempt(s): no_svg_found",
    "requestId": "req-1",
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

## How the SVG parser works

The prompt asks the model to emit `<reasoning>…</reasoning>` followed by a fenced
`xml` block. The parser does not trust that contract:

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

## Project layout

```
.
├── prompts/
│   └── vectorize.md          # system prompt (moved from ./prompt.md)
├── src/
│   ├── index.ts              # bootstrap + graceful shutdown
│   ├── app.ts                # Fastify factory (injectable for tests)
│   ├── config.ts             # env schema + typed config
│   ├── routes/
│   │   └── vectorize.ts      # HTTP contract
│   ├── services/
│   │   ├── openrouter.ts     # upstream client
│   │   ├── prompt.ts         # prompt loading + version hash
│   │   ├── image.ts          # magic-byte validation + normalization
│   │   ├── svg-parser.ts     # extraction, validation, sanitization
│   │   └── vectorize.ts      # orchestration + repair retry
│   └── lib/
│       ├── errors.ts
│       ├── logger.ts
│       ├── semaphore.ts
│       └── text.ts
└── test/
    ├── fixtures/
    │   └── responses/        # parser fixtures
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

## Docker

```bash
docker build -t vector .
docker run --rm -p 8080:8080 \
  -e OPENROUTER_API_KEY=... \
  -e OPENROUTER_MODEL=google/gemini-2.5-flash \
  vector
```

## Notes and limitations

- Stateless: no persistence, caching, or job queue.
- No authentication; deploy behind a trusted network boundary or add a gateway.
- The service sanitizes SVG output, but you should still serve untrusted SVGs with a
  restrictive CSP (the service sets one on its own responses).
- Image inputs are downscaled to `MAX_IMAGE_DIMENSION` (default **1568 px on the
  longest side**) before the VLM call. 1568 is a common vision-model sweet spot: it
  preserves enough detail for edge tracing while keeping image tokens low. The
  `MAX_UPLOAD_BYTES` limit is a separate safety cap on the raw upload.
- The model is responsible for mapping the subject onto the 1024×1024 canvas.
