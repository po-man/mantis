import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import type { Config } from "../src/config.js";
import { AppError } from "../src/lib/errors.js";
import { OpenRouterClient } from "../src/services/openrouter.js";

function makeConfig(baseUrl: string, overrides: Partial<Config> = {}): Config {
  return {
    nodeEnv: "test",
    port: 0,
    host: "127.0.0.1",
    logLevel: "silent",
    openrouterApiKey: "test-key",
    openrouterModel: "test/model",
    openrouterBaseUrl: baseUrl,
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
    reviewUiEnabled: false,
    publishEnabled: false,
    publishDir: ".publish",
    publishInputDimension: 384,
    ...overrides,
  };
}

interface CapturedRequest {
  url?: string;
  headers?: IncomingHttpHeaders;
  body?: Record<string, unknown>;
}

const servers: Server[] = [];

async function startServer(
  handler: (
    request: CapturedRequest,
    respond: (status: number, body: string) => void,
  ) => void,
): Promise<string> {
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      const captured: CapturedRequest = {
        url: req.url,
        headers: req.headers,
        body: raw ? (JSON.parse(raw) as Record<string, unknown>) : undefined,
      };
      handler(captured, (status, body) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(body);
      });
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  servers.push(server);

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Test server did not expose a port");
  }
  return `http://127.0.0.1:${address.port}`;
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        }),
    ),
  );
});

describe("OpenRouterClient", () => {
  it("sends the expected request and parses a string response", async () => {
    let captured: CapturedRequest | undefined;

    const baseUrl = await startServer((request, respond) => {
      captured = request;
      respond(
        200,
        JSON.stringify({
          model: "test/model",
          choices: [
            { message: { content: "hello" }, finish_reason: "stop" },
          ],
          usage: {
            prompt_tokens: 1,
            completion_tokens: 2,
            total_tokens: 3,
          },
        }),
      );
    });

    const client = new OpenRouterClient(makeConfig(baseUrl));
    const result = await client.complete(
      [{ role: "user", content: "hi" }],
      { maxTokens: 2048 },
    );

    expect(result.content).toBe("hello");
    expect(result.finishReason).toBe("stop");
    expect(result.usage).toEqual({
      promptTokens: 1,
      completionTokens: 2,
      totalTokens: 3,
      cachedTokens: 0,
      reasoningTokens: 0,
      costUsd: null,
    });

    expect(captured?.url).toBe("/chat/completions");
    expect(captured?.headers?.authorization).toBe("Bearer test-key");
    expect(captured?.headers?.["x-title"]).toBe("vector-test");
    expect(captured?.body?.model).toBe("test/model");
    expect(captured?.body?.max_tokens).toBe(2048);
    expect(captured?.body?.temperature).toBe(0.2);
    expect(captured?.body?.reasoning).toBeUndefined();
    expect(captured?.body?.usage).toEqual({ include: true });
  });

  it("parses billed cost and cache statistics", async () => {
    const baseUrl = await startServer((_request, respond) => {
      respond(
        200,
        JSON.stringify({
          model: "test/model",
          choices: [{ message: { content: "hello" }, finish_reason: "stop" }],
          usage: {
            prompt_tokens: 1000,
            completion_tokens: 200,
            total_tokens: 1200,
            cost: 0.000412,
            prompt_tokens_details: { cached_tokens: 900 },
            completion_tokens_details: { reasoning_tokens: 120 },
          },
        }),
      );
    });

    const client = new OpenRouterClient(makeConfig(baseUrl));
    const result = await client.complete([{ role: "user", content: "hi" }]);

    expect(result.usage).toEqual({
      promptTokens: 1000,
      completionTokens: 200,
      totalTokens: 1200,
      cachedTokens: 900,
      reasoningTokens: 120,
      costUsd: 0.000412,
    });
  });

  it("sends the configured reasoning effort", async () => {
    let captured: CapturedRequest | undefined;

    const baseUrl = await startServer((request, respond) => {
      captured = request;
      respond(
        200,
        JSON.stringify({
          model: "test/model",
          choices: [{ message: { content: "hello" }, finish_reason: "stop" }],
        }),
      );
    });

    const client = new OpenRouterClient(
      makeConfig(baseUrl, { openrouterReasoningEffort: "low" }),
    );
    await client.complete([{ role: "user", content: "hi" }]);

    expect(captured?.body?.reasoning).toEqual({ effort: "low" });
  });

  it("logs request id, token usage, and latency after a call", async () => {
    const baseUrl = await startServer((_request, respond) => {
      respond(
        200,
        JSON.stringify({
          model: "test/model",
          choices: [
            { message: { content: "hello" }, finish_reason: "stop" },
          ],
          usage: {
            prompt_tokens: 1,
            completion_tokens: 2,
            total_tokens: 3,
            cost: 0.5,
            prompt_tokens_details: { cached_tokens: 1 },
            completion_tokens_details: { reasoning_tokens: 1 },
          },
        }),
      );
    });

    const logs: Array<{ obj: Record<string, unknown>; msg?: string }> = [];
    const logger = {
      info: (obj: Record<string, unknown>, msg?: string) => {
        logs.push({ obj, msg });
      },
    };

    const client = new OpenRouterClient(makeConfig(baseUrl));
    await client.complete([{ role: "user", content: "hi" }], {
      requestId: "req-123",
      logger,
    });

    expect(logs).toHaveLength(1);
    expect(logs[0]?.msg).toBe("openrouter call completed");
    expect(logs[0]?.obj).toMatchObject({
      requestId: "req-123",
      model: "test/model",
      promptTokens: 1,
      completionTokens: 2,
      totalTokens: 3,
      reasoningTokens: 1,
      cachedTokens: 1,
      costUsd: 0.5,
      finishReason: "stop",
      contentLength: 5,
    });
    expect(typeof logs[0]?.obj.latencyMs).toBe("number");
  });

  it("logs usage even when the completion is empty", async () => {
    const baseUrl = await startServer((_request, respond) => {
      respond(
        200,
        JSON.stringify({
          choices: [{ message: { content: null }, finish_reason: "length" }],
          usage: {
            prompt_tokens: 1,
            completion_tokens: 2,
            total_tokens: 3,
          },
        }),
      );
    });

    const logs: Array<{ obj: Record<string, unknown>; msg?: string }> = [];
    const logger = {
      info: (obj: Record<string, unknown>, msg?: string) => {
        logs.push({ obj, msg });
      },
    };

    const client = new OpenRouterClient(makeConfig(baseUrl));
    await expect(
      client.complete([{ role: "user", content: "hi" }], {
        requestId: "req-empty",
        logger,
      }),
    ).rejects.toMatchObject({ code: "upstream_error", statusCode: 502 });

    expect(logs).toHaveLength(1);
    expect(logs[0]?.obj).toMatchObject({
      requestId: "req-empty",
      totalTokens: 3,
      finishReason: "length",
      contentLength: 0,
    });
  });

  it("joins array-shaped content parts", async () => {
    const baseUrl = await startServer((_request, respond) => {
      respond(
        200,
        JSON.stringify({
          choices: [
            {
              message: {
                content: [
                  { type: "text", text: "<svg>" },
                  { type: "text", text: "</svg>" },
                ],
              },
            },
          ],
        }),
      );
    });

    const client = new OpenRouterClient(makeConfig(baseUrl));
    const result = await client.complete([{ role: "user", content: "hi" }]);
    expect(result.content).toBe("<svg></svg>");
  });

  it("maps 429 to rate_limited", async () => {
    const baseUrl = await startServer((_request, respond) => {
      respond(429, JSON.stringify({ error: { message: "slow down" } }));
    });

    const client = new OpenRouterClient(makeConfig(baseUrl));
    await expect(
      client.complete([{ role: "user", content: "hi" }]),
    ).rejects.toMatchObject({ code: "rate_limited", statusCode: 429 });
  });

  it("maps 401 to config_error", async () => {
    const baseUrl = await startServer((_request, respond) => {
      respond(401, JSON.stringify({ error: { message: "bad key" } }));
    });

    const client = new OpenRouterClient(makeConfig(baseUrl));
    await expect(
      client.complete([{ role: "user", content: "hi" }]),
    ).rejects.toMatchObject({ code: "config_error", statusCode: 500 });
  });

  it("rejects an empty completion", async () => {
    const baseUrl = await startServer((_request, respond) => {
      respond(
        200,
        JSON.stringify({ choices: [{ message: { content: "   " } }] }),
      );
    });

    const client = new OpenRouterClient(makeConfig(baseUrl));
    await expect(
      client.complete([{ role: "user", content: "hi" }]),
    ).rejects.toBeInstanceOf(AppError);
  });

  it("rejects a non-JSON upstream response", async () => {
    const baseUrl = await startServer((_request, respond) => {
      respond(200, "not json");
    });

    const client = new OpenRouterClient(makeConfig(baseUrl));
    await expect(
      client.complete([{ role: "user", content: "hi" }]),
    ).rejects.toMatchObject({ code: "upstream_error", statusCode: 502 });
  });

  it("maps a timeout to upstream_timeout", async () => {
    const baseUrl = await startServer((_request, respond) => {
      setTimeout(() => {
        respond(200, JSON.stringify({ choices: [] }));
      }, 250);
    });

    const client = new OpenRouterClient(
      makeConfig(baseUrl, { openrouterTimeoutMs: 50 }),
    );
    await expect(
      client.complete([{ role: "user", content: "hi" }]),
    ).rejects.toMatchObject({ code: "upstream_timeout", statusCode: 504 });
  });
});
