import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import type { Config } from "../src/config.js";
import { Semaphore } from "../src/lib/semaphore.js";
import type {
  ChatClient,
  ChatMessage,
  OpenRouterResult,
} from "../src/services/openrouter.js";
import type { PromptBundle } from "../src/services/prompt.js";

const VALID_SVG = [
  "```xml",
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="100%" height="100%">',
  '  <path d="M100 100 L900 100 L900 900 L100 900 Z" fill="#ff0000"/>',
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
    promptPath: "prompts/vectorize.md",
    maxUploadBytes: 5 * 1024 * 1024,
    maxImageDimension: 512,
    maxConcurrency: 2,
    maxQueue: 4,
    retryOnInvalidSvg: 1,
    requestTimeoutMs: 10_000,
    ...overrides,
  };
}

class FakeClient implements ChatClient {
  readonly calls: Array<{
    messages: ChatMessage[];
    options?: { maxTokens?: number; signal?: AbortSignal };
  }> = [];

  constructor(private readonly responses: string[]) {}

  async complete(
    messages: ChatMessage[],
    options: { maxTokens?: number; signal?: AbortSignal } = {},
  ): Promise<OpenRouterResult> {
    this.calls.push({ messages, options });
    const index = Math.min(this.calls.length - 1, this.responses.length - 1);
    return {
      content: this.responses[index] ?? "",
      finishReason: "stop",
      usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
      model: "test/model",
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
    expect(response.headers["content-disposition"]).toContain("vector.svg");
    expect(client.calls).toHaveLength(1);
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
