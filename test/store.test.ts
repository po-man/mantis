import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import type { ParallaxRig } from "../src/services/parallax.js";
import {
  ConversionStore,
  type ConversionRecordInput,
} from "../src/services/store.js";

const PROMPT = {
  version: "prompt-v1",
  text: "You are a vector illustrator.",
  path: "/tmp/prompt.md",
};

const RIG = {
  format: "vector.parallax",
  version: 1,
  viewBox: [0, 0, 1024, 1024],
  cursor: { space: "normalized", neutral: [0.5, 0.5] },
  defaults: {
    shift: 40,
    scale: 0.06,
    rotate: 1.5,
    proximity: 0.55,
    direction: "inverse",
    neutralZ: 0.5,
  },
  nodes: [],
  anchors: [],
  synthetic: false,
  warnings: [],
} satisfies ParallaxRig;

function makeStore(): ConversionStore {
  return new ConversionStore(":memory:");
}

function makeEntry(
  promptId: number,
  overrides: Partial<ConversionRecordInput> = {},
): ConversionRecordInput {
  return {
    requestId: `req-${Math.random().toString(36).slice(2)}`,
    status: "success",
    model: "test/model",
    promptId,
    attempts: 1,
    input: {
      mime: "image/png",
      width: 100,
      height: 80,
      bytes: 4,
      originalWidth: 200,
      originalHeight: 160,
      originalBytes: 8,
      downsampled: true,
      data: Buffer.from([1, 2, 3, 4]),
    },
    output: {
      svg: '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>',
      bytes: 60,
      elements: 2,
      paths: 1,
      rig: RIG,
      warnings: ["added default viewBox"],
    },
    metrics: {
      latencyMs: 120,
      upstreamLatencyMs: 100,
      promptTokens: 10,
      completionTokens: 20,
      totalTokens: 30,
      cachedTokens: 0,
      reasoningTokens: 0,
      costUsd: null,
      calls: [
        {
          attempt: 1,
          model: "test/model",
          latencyMs: 100,
          promptTokens: 10,
          completionTokens: 20,
          totalTokens: 30,
          cachedTokens: 0,
          reasoningTokens: 0,
          costUsd: null,
          finishReason: "stop",
          contentLength: 60,
        },
      ],
    },
    error: null,
    ...overrides,
  };
}

describe("ConversionStore", () => {
  it("stores a prompt once and reuses its id", () => {
    const store = makeStore();
    const first = store.upsertPrompt(PROMPT);
    const second = store.upsertPrompt(PROMPT);

    expect(second).toBe(first);

    store.record(makeEntry(first));
    store.record(makeEntry(first));

    const stats = store.stats();
    expect(stats.total).toBe(2);
    expect(stats.prompts).toHaveLength(1);
    expect(stats.prompts[0]?.version).toBe(PROMPT.version);
    store.close();
  });

  it("lists, filters, and returns conversion details", () => {
    const store = makeStore();
    const promptId = store.upsertPrompt(PROMPT);
    const successId = store.record(
      makeEntry(promptId, { requestId: "req-success" }),
    );
    store.record(
      makeEntry(promptId, {
        requestId: "req-error",
        status: "error",
        model: "other/model",
        output: null,
        error: { code: "invalid_svg", message: "no svg" },
      }),
    );

    const all = store.list();
    expect(all.total).toBe(2);
    expect(all.items[0]?.requestId).toBe("req-error");

    const successes = store.list({ status: "success" });
    expect(successes.total).toBe(1);
    expect(successes.items[0]?.requestId).toBe("req-success");

    const byModel = store.list({ model: "other/model" });
    expect(byModel.total).toBe(1);

    const byPrompt = store.list({ promptVersion: PROMPT.version });
    expect(byPrompt.total).toBe(2);

    const bySearch = store.list({ q: "req-success" });
    expect(bySearch.total).toBe(1);

    const detail = store.get(successId);
    expect(detail?.prompt.text).toBe(PROMPT.text);
    expect(detail?.warnings).toEqual(["added default viewBox"]);
    expect(detail?.calls).toHaveLength(1);
    expect(detail?.downsampled).toBe(true);
    expect(detail?.hasInput).toBe(true);
    expect(detail?.hasRig).toBe(true);
    expect(detail?.rigNodes).toBe(0);
    expect(detail?.rig?.format).toBe("vector.parallax");

    const input = store.getInput(successId);
    expect(input?.mime).toBe("image/png");
    expect(input?.data).toEqual(Buffer.from([1, 2, 3, 4]));

    expect(store.getOutput(successId)).toContain("<svg");
    expect(store.getRig(successId)?.format).toBe("vector.parallax");
    expect(store.get(9999)).toBeNull();
    store.close();
  });

  it("records billed cost and prompt-cache tokens", () => {
    const store = makeStore();
    const promptId = store.upsertPrompt(PROMPT);
    const id = store.record(
      makeEntry(promptId, {
        metrics: {
          latencyMs: 100,
          upstreamLatencyMs: 90,
          promptTokens: 4000,
          completionTokens: 2000,
          totalTokens: 6000,
          cachedTokens: 3000,
          reasoningTokens: 200,
          costUsd: 0.0012,
          calls: [],
        },
      }),
    );

    const item = store.list().items[0];
    expect(item?.costUsd).toBe(0.0012);
    expect(item?.cachedTokens).toBe(3000);
    expect(item?.reasoningTokens).toBe(200);
    expect(store.get(id)?.costUsd).toBe(0.0012);

    const stats = store.stats();
    expect(stats.totalCostUsd).toBeCloseTo(0.0012, 10);
    expect(stats.avgCostUsd).toBeCloseTo(0.0012, 10);
    expect(stats.costedConversions).toBe(1);
    expect(stats.cacheHitRate).toBeCloseTo(0.75, 10);
    expect(stats.totalReasoningTokens).toBe(200);
    expect(stats.prompts[0]?.totalCostUsd).toBeCloseTo(0.0012, 10);
    expect(stats.prompts[0]?.costedConversions).toBe(1);
    store.close();
  });

  it("adds cost columns to a database created before cost telemetry", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "vector-store-"));
    const file = path.join(dir, "vector.db");
    new ConversionStore(file).close();

    const raw = new DatabaseSync(file);
    raw.exec(
      "ALTER TABLE conversions DROP COLUMN cached_tokens;" +
        "ALTER TABLE conversions DROP COLUMN reasoning_tokens;" +
        "ALTER TABLE conversions DROP COLUMN cost_usd;",
    );
    raw.close();

    const store = new ConversionStore(file);
    const promptId = store.upsertPrompt(PROMPT);
    const id = store.record(
      makeEntry(promptId, {
        metrics: {
          latencyMs: 10,
          upstreamLatencyMs: 10,
          promptTokens: 100,
          completionTokens: 50,
          totalTokens: 150,
          cachedTokens: 40,
          reasoningTokens: 10,
          costUsd: 0.5,
          calls: [],
        },
      }),
    );

    expect(store.get(id)?.costUsd).toBe(0.5);
    expect(store.get(id)?.cachedTokens).toBe(40);
    expect(store.list().items[0]?.reasoningTokens).toBe(10);
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("stores publication ratings and filters selections", () => {
    const store = makeStore();
    const promptId = store.upsertPrompt(PROMPT);
    const niceId = store.record(makeEntry(promptId, { requestId: "req-nice" }));
    const fairId = store.record(makeEntry(promptId, { requestId: "req-fair" }));
    const badId = store.record(makeEntry(promptId, { requestId: "req-bad" }));
    const unratedId = store.record(
      makeEntry(promptId, { requestId: "req-unrated" }),
    );

    expect(store.setSelection(niceId, "nice")).toBe("nice");
    expect(store.setSelection(fairId, "fair")).toBe("fair");
    expect(store.setSelection(badId, "bad")).toBe("bad");

    expect(store.selectionCounts()).toEqual({
      nice: 1,
      fair: 1,
      bad: 1,
      total: 3,
    });
    expect(store.list().items.find((item) => item.id === fairId)?.rating).toBe(
      "fair",
    );
    expect(store.get(badId)?.rating).toBe("bad");
    expect(store.list({ rating: "nice" }).items.map((item) => item.id)).toEqual([
      niceId,
    ]);
    expect(
      store.list({ rating: "unrated" }).items.map((item) => item.id),
    ).toEqual([unratedId]);
    expect(store.listSelected().map((item) => item.rating)).toEqual([
      "nice",
      "fair",
      "bad",
    ]);

    expect(store.setSelection(niceId, null)).toBeNull();
    expect(store.get(niceId)?.rating).toBeNull();
    expect(store.selectionCounts().total).toBe(2);
    store.close();
  });

  it("stores a single featured conversion independently of ratings", () => {
    const store = makeStore();
    const promptId = store.upsertPrompt(PROMPT);
    const first = store.record(makeEntry(promptId, { requestId: "req-first" }));
    const second = store.record(
      makeEntry(promptId, { requestId: "req-second" }),
    );

    expect(store.getFeaturedId()).toBeNull();
    expect(store.setFeatured(first)).toBe(first);
    expect(store.getFeaturedId()).toBe(first);
    expect(store.list().items.find((item) => item.id === first)?.featured).toBe(
      true,
    );
    expect(store.get(first)?.featured).toBe(true);
    expect(store.list({ rating: "unrated" }).items).toHaveLength(2);

    store.setFeatured(second);
    expect(store.getFeaturedId()).toBe(second);
    expect(store.get(first)?.featured).toBe(false);
    expect(store.get(second)?.featured).toBe(true);

    expect(store.setFeatured(null)).toBeNull();
    expect(store.getFeaturedId()).toBeNull();
    expect(store.get(second)?.featured).toBe(false);
    store.close();
  });

  it("computes aggregate statistics", () => {
    const store = makeStore();
    const promptId = store.upsertPrompt(PROMPT);
    store.record(makeEntry(promptId));
    store.record(
      makeEntry(promptId, {
        status: "error",
        output: null,
        metrics: {
          latencyMs: 80,
          upstreamLatencyMs: 60,
          promptTokens: 5,
          completionTokens: 0,
          totalTokens: 5,
          cachedTokens: 0,
          reasoningTokens: 0,
          costUsd: null,
          calls: [],
        },
        error: { code: "upstream_error", message: "boom" },
      }),
    );

    const stats = store.stats();
    expect(stats.total).toBe(2);
    expect(stats.successes).toBe(1);
    expect(stats.errors).toBe(1);
    expect(stats.successRate).toBe(0.5);
    expect(stats.downsampled).toBe(2);
    expect(stats.totalTokens).toBe(35);
    expect(stats.avgLatencyMs).toBe(100);
    expect(stats.prompts[0]?.total).toBe(2);
    store.close();
  });
});
