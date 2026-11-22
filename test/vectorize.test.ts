import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import type { Config } from "../src/config.js";
import { Semaphore } from "../src/lib/semaphore.js";
import type {
  ChatClient,
  ChatMessage,
  CompleteOptions,
  OpenRouterResult,
} from "../src/services/openrouter.js";
import type { PromptBundle } from "../src/services/prompt.js";
import { aggregateUsage, vectorizeImage, type LlmCallMetric } from "../src/services/vectorize.js";

const VALID_SVG = [
  "```xml",
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="100%" height="100%">',
  '  <g id="subject" data-z="0.5" data-pivot="512,512">',
  '    <g id="back" data-z="0.2" data-pivot="300,400">',
  '      <rect x="100" y="200" width="200" height="300" fill="#cccccc" stroke="none"/>',
  "    </g>",
  '    <g id="front" data-z="0.8" data-pivot="600,500">',
  '      <circle cx="600" cy="500" r="120" fill="#ff0000" stroke="none"/>',
  "    </g>",
  "  </g>",
  "</svg>",
  "```",
].join("\n");

// Non-ASCII warning text used to end up in a response header and made Fastify
// throw ERR_INVALID_CHAR, turning a successful conversion into a 500.
const NON_ASCII_WARNING_SVG = [
  "```xml",
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="😀" width="100%" height="100%">',
  '  <circle cx="512" cy="512" r="200" fill="#ff0000" stroke="none"/>',
  "</svg>",
  "```",
].join("\n");

const PROMPT: PromptBundle = {
  text: "You are a vector illustrator.",
  version: "testversion",
  path: "/tmp/prompt.md",
};

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    nodeEnv: "test",
    port: 0,
    host: "127.0.0.1",
    logLevel: "silent",
    openrouterApiKey: "test-key",
    openrouterModel: "test/model",
    openrouterBaseUrl: "https://openrouter.ai/api/v1",
    openrouterTemperature: 0.2,
    openrouterMaxTokens: 1024,
    openrouterTimeoutMs: 5_000,
    openrouterAppTitle: "vector-test",
    promptVersion: "v001",
    promptDir: "prompts",
    maxUploadBytes: 5 * 1024 * 1024,
    maxImageDimension: 512,
    maxConcurrency: 2,
    maxQueue: 4,
    retryOnInvalidSvg: 1,
    requestTimeoutMs: 10_000,
    databasePath: ":memory:",
    reviewUiEnabled: true,
    publishEnabled: true,
    publishDir: ".publish",
    publishInputDimension: 384,
    ...overrides,
  };
}

class FakeClient implements ChatClient {
  readonly calls: Array<{
    messages: ChatMessage[];
    options?: CompleteOptions;
  }> = [];

  constructor(private readonly responses: string[]) {}

  async complete(
    messages: ChatMessage[],
    options: CompleteOptions = {},
  ): Promise<OpenRouterResult> {
    this.calls.push({ messages, options });
    const index = Math.min(this.calls.length - 1, this.responses.length - 1);
    return {
      content: this.responses[index] ?? "",
      finishReason: "stop",
      usage: {
        promptTokens: 10,
        completionTokens: 20,
        totalTokens: 30,
        cachedTokens: 0,
        reasoningTokens: 0,
        costUsd: null,
      },
      model: "test/model",
      latencyMs: 5,
    };
  }
}

function multipart(
  data: Buffer,
  filename = "object.png",
  contentType = "image/png",
): { payload: Buffer; contentType: string } {
  const boundary = "----vector-test-boundary";
  const head = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="image"; filename="${filename}"\r\n` +
      `Content-Type: ${contentType}\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    payload: Buffer.concat([head, data, tail]),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

async function makePng(): Promise<Buffer> {
  return sharp({
    create: {
      width: 16,
      height: 16,
      channels: 3,
      background: { r: 255, g: 0, b: 0 },
    },
  })
    .png()
    .toBuffer();
}

const apps: FastifyInstance[] = [];

async function makeApp(
  client: ChatClient,
  config: Config = makeConfig(),
): Promise<FastifyInstance> {
  const app = await buildApp({
    config,
    prompt: PROMPT,
    client,
    semaphore: new Semaphore(config.maxConcurrency),
  });
  apps.push(app);
  return app;
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("POST /v1/vectorize", () => {
  it("returns SVG for a multipart upload", async () => {
    const client = new FakeClient([VALID_SVG]);
    const app = await makeApp(client);
    const png = await makePng();
    const form = multipart(png);

    const response = await app.inject({
      method: "POST",
      url: "/v1/vectorize",
      headers: { "content-type": form.contentType },
      payload: form.payload,
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("image/svg+xml");
    expect(response.body).toContain("<svg");
    expect(response.headers["x-model"]).toBe("test/model");
    expect(response.headers["x-prompt-version"]).toBe("testversion");
    expect(response.headers["x-rig-nodes"]).toBe("3");
    expect(response.headers["content-disposition"]).toContain("vector.svg");
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]?.options?.requestId).toBeTruthy();
    expect(client.calls[0]?.options?.logger).toBeDefined();
  });

  it("generates unique request ids across restarts", async () => {
    const png = await makePng();
    const payload = { image: png.toString("base64") };
    const firstApp = await makeApp(new FakeClient([VALID_SVG]));
    const secondApp = await makeApp(new FakeClient([VALID_SVG]));

    const first = await firstApp.inject({
      method: "POST",
      url: "/v1/vectorize",
      payload,
    });
    const second = await secondApp.inject({
      method: "POST",
      url: "/v1/vectorize",
      payload,
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);

    const firstId = first.headers["x-request-id"];
    const secondId = second.headers["x-request-id"];
    const uuidPattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    expect(firstId).toMatch(uuidPattern);
    expect(secondId).toMatch(uuidPattern);
    expect(firstId).not.toBe(secondId);
  });

  it("returns JSON when ?format=json is used", async () => {
    const client = new FakeClient([VALID_SVG]);
    const app = await makeApp(client);
    const png = await makePng();

    const response = await app.inject({
      method: "POST",
      url: "/v1/vectorize?format=json",
      payload: { image: `data:image/png;base64,${png.toString("base64")}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.svg).toContain("<svg");
    expect(body.model).toBe("test/model");
    expect(body.usage.totalTokens).toBe(30);
    expect(body.promptVersion).toBe("testversion");
    expect(body.requestId).toBeTruthy();
    expect(body.rig.format).toBe("vector.parallax");
    expect(body.rig.nodes).toHaveLength(3);
    expect(body.rig.nodes.map((node: { id: string }) => node.id)).toEqual([
      "subject",
      "back",
      "front",
    ]);
  });

  it("keeps non-ASCII warnings out of response headers", async () => {
    const client = new FakeClient([NON_ASCII_WARNING_SVG]);
    const app = await makeApp(client);
    const png = await makePng();
    const payload = { image: png.toString("base64") };

    const svgResponse = await app.inject({
      method: "POST",
      url: "/v1/vectorize",
      payload,
    });
    expect(svgResponse.statusCode).toBe(200);
    expect(svgResponse.headers["x-svg-warnings"]).toBeUndefined();

    const jsonResponse = await app.inject({
      method: "POST",
      url: "/v1/vectorize?format=json",
      payload,
    });
    expect(jsonResponse.statusCode).toBe(200);
    expect(jsonResponse.headers["x-svg-warnings"]).toBeUndefined();
    const { warnings } = jsonResponse.json() as { warnings: string[] };
    expect(warnings.join(" ")).toContain("invalid viewBox");
    expect(warnings.some((warning) => warning.includes("😀"))).toBe(true);
  });

  it("persists conversions and exposes them through the review API", async () => {
    const client = new FakeClient([VALID_SVG]);
    const app = await makeApp(client);
    const png = await makePng();
    const payload = { image: png.toString("base64") };

    await app.inject({ method: "POST", url: "/v1/vectorize", payload });
    await app.inject({ method: "POST", url: "/v1/vectorize", payload });

    const page = await app.inject({ method: "GET", url: "/review" });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain("vector · review");

    const list = await app.inject({
      method: "GET",
      url: "/review/api/conversions",
    });
    expect(list.statusCode).toBe(200);
    const body = list.json();
    expect(body.total).toBe(2);
    expect(body.items[0].hasInput).toBe(true);
    expect(body.items[0].totalTokens).toBe(30);

    const detail = await app.inject({
      method: "GET",
      url: `/review/api/conversions/${body.items[0].id}`,
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().prompt.text).toBe(PROMPT.text);
    expect(detail.json().calls).toHaveLength(1);
    expect(detail.json().calls[0].latencyMs).toBe(5);
    expect(detail.json().hasRig).toBe(true);
    expect(detail.json().rig.format).toBe("vector.parallax");
    expect(detail.json().rig.nodes).toHaveLength(3);

    const stats = await app.inject({ method: "GET", url: "/review/api/stats" });
    expect(stats.json().total).toBe(2);
    expect(stats.json().prompts).toHaveLength(1);

    const input = await app.inject({
      method: "GET",
      url: `/review/api/conversions/${body.items[0].id}/input`,
    });
    expect(input.statusCode).toBe(200);
    expect(input.headers["content-type"]).toContain("image/");

    const output = await app.inject({
      method: "GET",
      url: `/review/api/conversions/${body.items[0].id}/output.svg`,
    });
    expect(output.statusCode).toBe(200);
    expect(output.body).toContain("<svg");

    const rig = await app.inject({
      method: "GET",
      url: `/review/api/conversions/${body.items[0].id}/rig.json`,
    });
    expect(rig.statusCode).toBe(200);
    expect(rig.json().format).toBe("vector.parallax");
    expect(rig.json().nodes).toHaveLength(3);

    const parallaxSvg = await app.inject({
      method: "GET",
      url: `/review/api/conversions/${body.items[0].id}/parallax.svg`,
    });
    expect(parallaxSvg.statusCode).toBe(200);
    expect(parallaxSvg.body).toContain('id="subject"');
  });

  it("rates conversions and writes a local publication bundle", async () => {
    const publishDir = mkdtempSync(path.join(tmpdir(), "vector-review-publish-"));
    const client = new FakeClient([VALID_SVG, VALID_SVG]);
    const app = await makeApp(client, makeConfig({ publishDir }));
    const png = await makePng();
    const payload = { image: png.toString("base64") };

    await app.inject({ method: "POST", url: "/v1/vectorize", payload });
    await app.inject({ method: "POST", url: "/v1/vectorize", payload });

    const list = await app.inject({
      method: "GET",
      url: "/review/api/conversions",
    });
    const items = list.json().items as Array<{
      id: number;
      featured: boolean;
    }>;
    const first = items[0]!;
    const second = items[1]!;

    const invalid = await app.inject({
      method: "PUT",
      url: `/review/api/conversions/${first.id}/selection`,
      payload: { rating: "great" },
    });
    expect(invalid.statusCode).toBe(400);

    const rated = await app.inject({
      method: "PUT",
      url: `/review/api/conversions/${first.id}/selection`,
      payload: { rating: "nice" },
    });
    expect(rated.statusCode).toBe(200);
    expect(rated.json()).toEqual({ id: first.id, rating: "nice" });

    const filtered = await app.inject({
      method: "GET",
      url: "/review/api/conversions?rating=nice",
    });
    expect(filtered.json().total).toBe(1);

    const featured = await app.inject({
      method: "PUT",
      url: "/review/api/publication/featured",
      payload: { conversionId: second.id },
    });
    expect(featured.statusCode).toBe(200);
    expect(featured.json()).toEqual({ conversionId: second.id });

    const featuredList = await app.inject({
      method: "GET",
      url: "/review/api/conversions",
    });
    const featuredItems = featuredList.json().items as Array<{
      id: number;
      featured: boolean;
    }>;
    expect(
      featuredItems.find((item) => item.id === second.id)?.featured,
    ).toBe(true);
    expect(
      featuredItems.find((item) => item.id === first.id)?.featured,
    ).toBe(false);

    const meta = await app.inject({
      method: "GET",
      url: "/review/api/publication",
    });
    expect(meta.statusCode).toBe(200);
    expect(meta.json().counts).toEqual({ nice: 1, fair: 0, bad: 0, total: 1 });
    expect(meta.json().featured).toEqual({
      id: second.id,
      title: `Conversion #${second.id}`,
      rating: null,
    });
    expect(meta.json().exists).toBe(false);

    const toLong = await app.inject({
      method: "POST",
      url: "/review/api/publish",
      payload: { intro: Array.from({ length: 100 }, () => "word").join(" ") },
    });
    expect(toLong.statusCode).toBe(400);

    const published = await app.inject({
      method: "POST",
      url: "/review/api/publish",
      payload: {
        title: "Custom selected studies",
        intro: "A short publication intro.",
      },
    });
    expect(published.statusCode).toBe(200);
    const publishedBody = published.json() as {
      manifestPath: string;
      itemCount: number;
      introWords: number;
      featuredId: number | null;
    };
    expect(publishedBody.itemCount).toBe(1);
    expect(publishedBody.introWords).toBe(4);
    expect(publishedBody.featuredId).toBe(second.id);
    const manifestText = readFileSync(publishedBody.manifestPath, "utf8");
    expect(manifestText).toContain('"title": "Custom selected studies"');
    expect(manifestText).toContain('"rating": "nice"');
    expect(manifestText).toContain('"featured"');
    expect(manifestText).toContain(`"id": ${second.id}`);

    const after = await app.inject({
      method: "GET",
      url: "/review/api/publication",
    });
    expect(after.json().exists).toBe(true);
    expect(after.json().intro).toBe("A short publication intro.");

    rmSync(publishDir, { recursive: true, force: true });
  });

  it("publishes a featured-only bundle with no gallery items", async () => {
    const publishDir = mkdtempSync(path.join(tmpdir(), "vector-featured-only-"));
    const client = new FakeClient([VALID_SVG]);
    const app = await makeApp(client, makeConfig({ publishDir }));
    const png = await makePng();
    await app.inject({
      method: "POST",
      url: "/v1/vectorize",
      payload: { image: png.toString("base64") },
    });

    const list = await app.inject({
      method: "GET",
      url: "/review/api/conversions",
    });
    const id = (list.json().items as Array<{ id: number }>)[0]!.id;

    const featured = await app.inject({
      method: "PUT",
      url: "/review/api/publication/featured",
      payload: { conversionId: id },
    });
    expect(featured.statusCode).toBe(200);

    const published = await app.inject({
      method: "POST",
      url: "/review/api/publish",
      payload: { intro: "A featured-only publication." },
    });
    expect(published.statusCode).toBe(200);
    const body = published.json() as {
      itemCount: number;
      featuredId: number | null;
    };
    expect(body.itemCount).toBe(0);
    expect(body.featuredId).toBe(id);

    rmSync(publishDir, { recursive: true, force: true });
  });

  it("records failed conversions with their error", async () => {
    const client = new FakeClient(["I cannot do that.", "Still no SVG."]);
    const app = await makeApp(client);
    const png = await makePng();

    const response = await app.inject({
      method: "POST",
      url: "/v1/vectorize",
      payload: { image: png.toString("base64") },
    });
    expect(response.statusCode).toBe(422);

    const list = await app.inject({
      method: "GET",
      url: "/review/api/conversions?status=error",
    });
    expect(list.json().total).toBe(1);
    expect(list.json().items[0].errorCode).toBe("invalid_svg");
    expect(list.json().items[0].attempts).toBe(2);
  });

  it("returns JSON when the Accept header asks for it", async () => {
    const client = new FakeClient([VALID_SVG]);
    const app = await makeApp(client);
    const png = await makePng();

    const response = await app.inject({
      method: "POST",
      url: "/v1/vectorize",
      headers: { accept: "application/json" },
      payload: { image: png.toString("base64") },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().svg).toContain("<svg");
  });

  it("retries once and succeeds after an invalid first response", async () => {
    const client = new FakeClient(["I cannot do that.", VALID_SVG]);
    const app = await makeApp(client);
    const png = await makePng();

    const response = await app.inject({
      method: "POST",
      url: "/v1/vectorize",
      payload: { image: png.toString("base64") },
    });

    expect(response.statusCode).toBe(200);
    expect(client.calls).toHaveLength(2);
    expect(client.calls[1]?.messages.at(-1)?.role).toBe("user");
  });

  it("returns 422 after exhausting repair attempts", async () => {
    const client = new FakeClient(["I cannot do that.", "Still no SVG."]);
    const app = await makeApp(client);
    const png = await makePng();

    const response = await app.inject({
      method: "POST",
      url: "/v1/vectorize",
      payload: { image: png.toString("base64") },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe("invalid_svg");
    expect(client.calls).toHaveLength(2);
  });

  it("rejects unsupported image types", async () => {
    const client = new FakeClient([VALID_SVG]);
    const app = await makeApp(client);
    const form = multipart(Buffer.from("not an image"), "notes.txt", "text/plain");

    const response = await app.inject({
      method: "POST",
      url: "/v1/vectorize",
      headers: { "content-type": form.contentType },
      payload: form.payload,
    });

    expect(response.statusCode).toBe(415);
    expect(response.json().error.code).toBe("unsupported_media_type");
    expect(client.calls).toHaveLength(0);
  });

  it("rejects a missing image field", async () => {
    const client = new FakeClient([VALID_SVG]);
    const app = await makeApp(client);

    const response = await app.inject({
      method: "POST",
      url: "/v1/vectorize",
      payload: {},
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("bad_request");
  });

  it("rejects an oversized upload", async () => {
    const client = new FakeClient([VALID_SVG]);
    const app = await makeApp(client, makeConfig({ maxUploadBytes: 32 }));
    const png = await makePng();
    const form = multipart(png);

    const response = await app.inject({
      method: "POST",
      url: "/v1/vectorize",
      headers: { "content-type": form.contentType },
      payload: form.payload,
    });

    expect(response.statusCode).toBe(413);
    expect(response.json().error.code).toBe("payload_too_large");
  });
});

describe("ops endpoints", () => {
  it("reports liveness and readiness", async () => {
    const app = await makeApp(new FakeClient([VALID_SVG]));

    const health = await app.inject({ method: "GET", url: "/healthz" });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toEqual({ status: "ok" });

    const ready = await app.inject({ method: "GET", url: "/readyz" });
    expect(ready.statusCode).toBe(200);
    expect(ready.json().promptVersion).toBe("testversion");
  });

  it("returns the error envelope for unknown routes", async () => {
    const app = await makeApp(new FakeClient([VALID_SVG]));

    const response = await app.inject({ method: "GET", url: "/nope" });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("not_found");
  });
});

describe("aggregateUsage", () => {
  const call = (overrides: Partial<LlmCallMetric> = {}): LlmCallMetric => ({
    attempt: 1,
    model: "test/model",
    latencyMs: 10,
    promptTokens: 100,
    completionTokens: 200,
    totalTokens: 300,
    cachedTokens: 0,
    reasoningTokens: 0,
    costUsd: null,
    finishReason: "stop",
    contentLength: 100,
    ...overrides,
  });

  it("sums tokens and cost across attempts", () => {
    const usage = aggregateUsage([
      call({ costUsd: 0.001, cachedTokens: 80, reasoningTokens: 5 }),
      call({ attempt: 2, costUsd: 0.002 }),
    ]);

    expect(usage).toEqual({
      promptTokens: 200,
      completionTokens: 400,
      totalTokens: 600,
      cachedTokens: 80,
      reasoningTokens: 5,
      costUsd: 0.003,
    });
  });

  it("keeps cost null when no attempt reported one", () => {
    const usage = aggregateUsage([call(), call({ attempt: 2 })]);
    expect(usage?.costUsd).toBeNull();
  });

  it("returns null without calls", () => {
    expect(aggregateUsage([])).toBeNull();
  });
});

describe("retry token budget", () => {
  it("never shrinks maxTokens when the first attempt is truncated", async () => {
    const budgets: Array<number | undefined> = [];
    const truncated = '```xml\n<svg xmlns="http://www.w3.org/2000/svg"><path d="M';
    const client: ChatClient = {
      async complete(_messages, options = {}) {
        budgets.push(options.maxTokens);
        const first = budgets.length === 1;
        return {
          content: first ? truncated : VALID_SVG,
          finishReason: first ? "length" : "stop",
          usage: {
            promptTokens: 10,
            completionTokens: 20,
            totalTokens: 30,
            cachedTokens: 0,
            reasoningTokens: 0,
            costUsd: null,
          },
          model: "test/model",
          latencyMs: 5,
        };
      },
    };

    const result = await vectorizeImage(
      {
        config: makeConfig({ openrouterMaxTokens: 65_536 }),
        prompt: PROMPT,
        client,
      },
      {
        dataUrl: "data:image/png;base64,AAAA",
        data: Buffer.from("stub"),
        mime: "image/png",
        width: 16,
        height: 16,
        bytes: 4,
        originalWidth: 16,
        originalHeight: 16,
        resized: false,
      },
    );

    expect(result.attempts).toBe(2);
    expect(budgets[0]).toBe(65_536);
    expect(budgets[1]).toBe(65_536);
  });
});
