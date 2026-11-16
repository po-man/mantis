import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { ParallaxRig } from "./parallax.js";
import type { PublishRating } from "./publication-manifest.js";
import type { LlmCallMetric } from "./vectorize.js";

export interface PromptRecord {
  id: number;
  version: string;
  text: string;
  path: string;
  createdAt: number;
}

export interface ConversionInputImage {
  mime: string;
  width: number;
  height: number;
  bytes: number;
  originalWidth: number;
  originalHeight: number;
  originalBytes: number;
  downsampled: boolean;
  data: Buffer;
}

export interface ConversionOutput {
  svg: string;
  bytes: number;
  elements: number;
  paths: number;
  rig: ParallaxRig | null;
  warnings: string[];
}

export interface ConversionMetrics {
  latencyMs: number;
  upstreamLatencyMs: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedTokens: number;
  reasoningTokens: number;
  /** Billed cost in USD; null when the provider did not report one. */
  costUsd: number | null;
  calls: LlmCallMetric[];
}

export interface ConversionRecordInput {
  requestId: string;
  createdAt?: number;
  status: "success" | "error";
  model: string | null;
  promptId: number;
  attempts: number;
  input: ConversionInputImage | null;
  output: ConversionOutput | null;
  metrics: ConversionMetrics;
  error: { code: string; message: string } | null;
}

export interface ConversionListItem {
  id: number;
  requestId: string;
  createdAt: number;
  status: "success" | "error";
  model: string | null;
  promptVersion: string;
  attempts: number;
  downsampled: boolean;
  inputWidth: number | null;
  inputHeight: number | null;
  inputBytes: number | null;
  originalWidth: number | null;
  originalHeight: number | null;
  originalBytes: number | null;
  latencyMs: number;
  upstreamLatencyMs: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedTokens: number;
  reasoningTokens: number;
  costUsd: number | null;
  outputBytes: number | null;
  svgElements: number | null;
  svgPaths: number | null;
  hasRig: boolean;
  rigNodes: number | null;
  warningCount: number;
  errorCode: string | null;
  hasInput: boolean;
  rating: PublishRating | null;
  featured: boolean;
}

export interface ConversionDetail extends ConversionListItem {
  inputMime: string | null;
  warnings: string[];
  calls: LlmCallMetric[];
  errorMessage: string | null;
  rig: ParallaxRig | null;
  prompt: PromptRecord;
}

export interface ConversionListParams {
  limit?: number;
  offset?: number;
  status?: "success" | "error";
  model?: string;
  promptVersion?: string;
  q?: string;
  rating?: PublishRating | "unrated";
}

export interface SelectionCounts {
  nice: number;
  fair: number;
  bad: number;
  total: number;
}

export interface ConversionListResult {
  items: ConversionListItem[];
  total: number;
}

export interface PromptStats {
  promptId: number;
  version: string;
  total: number;
  successes: number;
  errors: number;
  avgLatencyMs: number;
  avgTokens: number;
  totalCostUsd: number;
  avgCostUsd: number;
  costedConversions: number;
}

export interface ConversionStats {
  total: number;
  successes: number;
  errors: number;
  successRate: number;
  downsampled: number;
  avgLatencyMs: number;
  avgTokens: number;
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  /** Sum of billed cost over conversions that reported one. */
  totalCostUsd: number;
  /** Average billed cost over conversions that reported one. */
  avgCostUsd: number;
  /** Rows carrying a cost; older conversions predate cost accounting. */
  costedConversions: number;
  totalCachedTokens: number;
  cacheHitRate: number;
  totalReasoningTokens: number;
  prompts: PromptStats[];
}

interface ConversionRow {
  id: number;
  request_id: string;
  created_at: number;
  status: "success" | "error";
  model: string | null;
  prompt_version: string;
  attempts: number;
  input_mime: string | null;
  input_width: number | null;
  input_height: number | null;
  input_bytes: number | null;
  original_width: number | null;
  original_height: number | null;
  original_bytes: number | null;
  downsampled: number;
  output_bytes: number | null;
  svg_elements: number | null;
  svg_paths: number | null;
  output_rig: string | null;
  rig_nodes: number | null;
  has_rig: number;
  warnings: string | null;
  latency_ms: number;
  upstream_latency_ms: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cached_tokens: number;
  reasoning_tokens: number;
  cost_usd: number | null;
  llm_calls: string | null;
  error_code: string | null;
  error_message: string | null;
  has_input: number;
  publish_rating: PublishRating | null;
  featured: number;
  prompt_id: number;
  prompt_text: string;
  prompt_path: string;
  prompt_created_at: number;
}

function resolveDatabasePath(databasePath: string): string {
  if (databasePath === ":memory:") {
    return databasePath;
  }
  const absolute = path.resolve(databasePath);
  mkdirSync(path.dirname(absolute), { recursive: true });
  return absolute;
}

function parseJsonArray<T>(value: string | null): T[] {
  if (!value) {
    return [];
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function parseJsonObject<T>(value: string | null): T | null {
  if (!value) {
    return null;
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === "object" && parsed !== null ? (parsed as T) : null;
  } catch {
    return null;
  }
}

function toListItem(row: ConversionRow): ConversionListItem {
  return {
    id: row.id,
    requestId: row.request_id,
    createdAt: row.created_at,
    status: row.status,
    model: row.model,
    promptVersion: row.prompt_version,
    attempts: row.attempts,
    downsampled: row.downsampled === 1,
    inputWidth: row.input_width,
    inputHeight: row.input_height,
    inputBytes: row.input_bytes,
    originalWidth: row.original_width,
    originalHeight: row.original_height,
    originalBytes: row.original_bytes,
    latencyMs: row.latency_ms,
    upstreamLatencyMs: row.upstream_latency_ms,
    promptTokens: row.prompt_tokens,
    completionTokens: row.completion_tokens,
    totalTokens: row.total_tokens,
    cachedTokens: row.cached_tokens,
    reasoningTokens: row.reasoning_tokens,
    costUsd: row.cost_usd,
    outputBytes: row.output_bytes,
    svgElements: row.svg_elements,
    svgPaths: row.svg_paths,
    hasRig: row.has_rig === 1,
    rigNodes: row.rig_nodes,
    warningCount: parseJsonArray<string>(row.warnings).length,
    errorCode: row.error_code,
    hasInput: row.has_input === 1,
    rating: row.publish_rating,
    featured: row.featured === 1,
  };
}

const LIST_COLUMNS = `
  c.id,
  c.request_id,
  c.created_at,
  c.status,
  c.model,
  p.version AS prompt_version,
  c.attempts,
  c.input_width,
  c.input_height,
  c.input_bytes,
  c.original_width,
  c.original_height,
  c.original_bytes,
  c.downsampled,
  c.output_bytes,
  c.svg_elements,
  c.svg_paths,
  c.rig_nodes,
  CASE WHEN c.output_rig IS NULL THEN 0 ELSE 1 END AS has_rig,
  c.warnings,
  c.latency_ms,
  c.upstream_latency_ms,
  c.prompt_tokens,
  c.completion_tokens,
  c.total_tokens,
  c.cached_tokens,
  c.reasoning_tokens,
  c.cost_usd,
  c.error_code,
  CASE WHEN c.input_image IS NULL THEN 0 ELSE 1 END AS has_input,
  s.rating AS publish_rating,
  CASE WHEN f.conversion_id IS NULL THEN 0 ELSE 1 END AS featured
`;

export class ConversionStore {
  private readonly db: DatabaseSync;

  constructor(databasePath: string) {
    this.db = new DatabaseSync(resolveDatabasePath(databasePath));
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA busy_timeout = 5000;
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS prompts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        version TEXT NOT NULL UNIQUE,
        text TEXT NOT NULL,
        path TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS conversions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        request_id TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('success', 'error')),
        model TEXT,
        prompt_id INTEGER NOT NULL REFERENCES prompts(id),
        attempts INTEGER NOT NULL DEFAULT 0,
        input_mime TEXT,
        input_width INTEGER,
        input_height INTEGER,
        input_bytes INTEGER,
        original_width INTEGER,
        original_height INTEGER,
        original_bytes INTEGER,
        downsampled INTEGER NOT NULL DEFAULT 0,
        input_image BLOB,
        output_svg TEXT,
        output_bytes INTEGER,
        svg_elements INTEGER,
        svg_paths INTEGER,
        output_rig TEXT,
        rig_nodes INTEGER,
        warnings TEXT,
        latency_ms INTEGER NOT NULL,
        upstream_latency_ms INTEGER NOT NULL,
        prompt_tokens INTEGER NOT NULL DEFAULT 0,
        completion_tokens INTEGER NOT NULL DEFAULT 0,
        total_tokens INTEGER NOT NULL DEFAULT 0,
        cached_tokens INTEGER NOT NULL DEFAULT 0,
        reasoning_tokens INTEGER NOT NULL DEFAULT 0,
        cost_usd REAL,
        llm_calls TEXT,
        error_code TEXT,
        error_message TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_conversions_created_at
        ON conversions(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_conversions_status
        ON conversions(status);
      CREATE INDEX IF NOT EXISTS idx_conversions_model
        ON conversions(model);
      CREATE INDEX IF NOT EXISTS idx_conversions_prompt
        ON conversions(prompt_id);

      CREATE TABLE IF NOT EXISTS publication_selections (
        conversion_id INTEGER PRIMARY KEY
          REFERENCES conversions(id) ON DELETE CASCADE,
        rating TEXT NOT NULL CHECK (rating IN ('nice', 'fair', 'bad')),
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_publication_selections_rating
        ON publication_selections(rating);

      CREATE TABLE IF NOT EXISTS publication_featured (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        conversion_id INTEGER NOT NULL
          REFERENCES conversions(id) ON DELETE CASCADE,
        updated_at INTEGER NOT NULL
      );
    `);

    // Existing databases predate the parallax columns.
    this.ensureColumn("conversions", "output_rig", "TEXT");
    this.ensureColumn("conversions", "rig_nodes", "INTEGER");
    // Existing databases predate cost telemetry.
    this.ensureColumn("conversions", "cached_tokens", "INTEGER NOT NULL DEFAULT 0");
    this.ensureColumn("conversions", "reasoning_tokens", "INTEGER NOT NULL DEFAULT 0");
    this.ensureColumn("conversions", "cost_usd", "REAL");
  }

  private ensureColumn(
    table: string,
    column: string,
    definition: string,
  ): void {
    const columns = this.db
      .prepare(`PRAGMA table_info(${table})`)
      .all() as unknown as Array<{ name: string }>;
    if (!columns.some((entry) => entry.name === column)) {
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }

  upsertPrompt(prompt: {
    version: string;
    text: string;
    path: string;
  }): number {
    this.db
      .prepare(
        `INSERT INTO prompts (version, text, path, created_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(version) DO UPDATE SET
           text = excluded.text,
           path = excluded.path`,
      )
      .run(prompt.version, prompt.text, prompt.path, Date.now());

    const row = this.db
      .prepare("SELECT id FROM prompts WHERE version = ?")
      .get(prompt.version) as { id: number } | undefined;

    if (!row) {
      throw new Error(`Failed to persist prompt ${prompt.version}`);
    }
    return row.id;
  }

  record(entry: ConversionRecordInput): number {
    const input = entry.input;
    const output = entry.output;
    const result = this.db
      .prepare(
        `INSERT INTO conversions (
           request_id, created_at, status, model, prompt_id, attempts,
           input_mime, input_width, input_height, input_bytes,
           original_width, original_height, original_bytes, downsampled,
           input_image, output_svg, output_bytes, svg_elements, svg_paths,
           output_rig, rig_nodes,
           warnings, latency_ms, upstream_latency_ms,
           prompt_tokens, completion_tokens, total_tokens,
           cached_tokens, reasoning_tokens, cost_usd, llm_calls,
           error_code, error_message
         ) VALUES (
           ?, ?, ?, ?, ?, ?,
           ?, ?, ?, ?,
           ?, ?, ?, ?,
           ?, ?, ?, ?, ?,
           ?, ?,
           ?, ?, ?,
           ?, ?, ?, ?, ?, ?, ?,
           ?, ?
         )`,
      )
      .run(
        entry.requestId,
        entry.createdAt ?? Date.now(),
        entry.status,
        entry.model,
        entry.promptId,
        entry.attempts,
        input?.mime ?? null,
        input?.width ?? null,
        input?.height ?? null,
        input?.bytes ?? null,
        input?.originalWidth ?? null,
        input?.originalHeight ?? null,
        input?.originalBytes ?? null,
        input?.downsampled ? 1 : 0,
        input?.data ?? null,
        output?.svg ?? null,
        output?.bytes ?? null,
        output?.elements ?? null,
        output?.paths ?? null,
        output?.rig ? JSON.stringify(output.rig) : null,
        output?.rig?.nodes.length ?? null,
        output ? JSON.stringify(output.warnings) : null,
        entry.metrics.latencyMs,
        entry.metrics.upstreamLatencyMs,
        entry.metrics.promptTokens,
        entry.metrics.completionTokens,
        entry.metrics.totalTokens,
        entry.metrics.cachedTokens,
        entry.metrics.reasoningTokens,
        entry.metrics.costUsd,
        JSON.stringify(entry.metrics.calls),
        entry.error?.code ?? null,
        entry.error?.message ?? null,
      );

    return Number(result.lastInsertRowid);
  }

  list(params: ConversionListParams = {}): ConversionListResult {
    const limit = Math.min(Math.max(params.limit ?? 25, 1), 100);
    const offset = Math.max(params.offset ?? 0, 0);
    const clauses: string[] = [];
    const values: Array<string | number> = [];

    if (params.status) {
      clauses.push("c.status = ?");
      values.push(params.status);
    }
    if (params.model) {
      clauses.push("c.model = ?");
      values.push(params.model);
    }
    if (params.promptVersion) {
      clauses.push("p.version = ?");
      values.push(params.promptVersion);
    }
    if (params.q) {
      clauses.push("(c.request_id LIKE ? OR c.model LIKE ? OR p.version LIKE ?)");
      const pattern = `%${params.q}%`;
      values.push(pattern, pattern, pattern);
    }
    if (params.rating === "unrated") {
      clauses.push("s.rating IS NULL");
    } else if (params.rating) {
      clauses.push("s.rating = ?");
      values.push(params.rating);
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";

    const countRow = this.db
      .prepare(
        `SELECT COUNT(*) AS total
         FROM conversions c
         JOIN prompts p ON p.id = c.prompt_id
         LEFT JOIN publication_selections s ON s.conversion_id = c.id
         LEFT JOIN publication_featured f ON f.conversion_id = c.id
         ${where}`,
      )
      .get(...values) as { total: number } | undefined;

    const rows = this.db
      .prepare(
        `SELECT ${LIST_COLUMNS}
         FROM conversions c
         JOIN prompts p ON p.id = c.prompt_id
         LEFT JOIN publication_selections s ON s.conversion_id = c.id
         LEFT JOIN publication_featured f ON f.conversion_id = c.id
         ${where}
         ORDER BY c.created_at DESC, c.id DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...values, limit, offset) as unknown as ConversionRow[];

    return {
      items: rows.map(toListItem),
      total: countRow?.total ?? 0,
    };
  }

  get(id: number): ConversionDetail | null {
    const row = this.db
      .prepare(
        `SELECT
           ${LIST_COLUMNS},
           c.input_mime,
           c.output_rig,
           c.llm_calls,
           c.error_message,
           c.prompt_id,
           p.text AS prompt_text,
           p.path AS prompt_path,
           p.created_at AS prompt_created_at
         FROM conversions c
         JOIN prompts p ON p.id = c.prompt_id
         LEFT JOIN publication_selections s ON s.conversion_id = c.id
         LEFT JOIN publication_featured f ON f.conversion_id = c.id
         WHERE c.id = ?`,
      )
      .get(id) as unknown as ConversionRow | undefined;

    if (!row) {
      return null;
    }

    return {
      ...toListItem(row),
      inputMime: row.input_mime,
      warnings: parseJsonArray<string>(row.warnings),
      calls: parseJsonArray<LlmCallMetric>(row.llm_calls),
      errorMessage: row.error_message,
      rig: parseJsonObject<ParallaxRig>(row.output_rig),
      prompt: {
        id: row.prompt_id,
        version: row.prompt_version,
        text: row.prompt_text,
        path: row.prompt_path,
        createdAt: row.prompt_created_at,
      },
    };
  }

  getInput(id: number): { mime: string; data: Buffer } | null {
    const row = this.db
      .prepare(
        `SELECT input_mime, input_image
         FROM conversions
         WHERE id = ?`,
      )
      .get(id) as
      | { input_mime: string | null; input_image: Uint8Array | null }
      | undefined;

    if (!row?.input_image) {
      return null;
    }

    return {
      mime: row.input_mime ?? "application/octet-stream",
      data: Buffer.from(row.input_image),
    };
  }

  getOutput(id: number): string | null {
    const row = this.db
      .prepare("SELECT output_svg FROM conversions WHERE id = ?")
      .get(id) as { output_svg: string | null } | undefined;
    return row?.output_svg ?? null;
  }

  getRig(id: number): ParallaxRig | null {
    const row = this.db
      .prepare("SELECT output_rig FROM conversions WHERE id = ?")
      .get(id) as { output_rig: string | null } | undefined;
    return parseJsonObject<ParallaxRig>(row?.output_rig ?? null);
  }

  setSelection(id: number, rating: PublishRating | null): PublishRating | null {
    if (rating === null) {
      this.db
        .prepare("DELETE FROM publication_selections WHERE conversion_id = ?")
        .run(id);
      return null;
    }

    this.db
      .prepare(
        `INSERT INTO publication_selections (conversion_id, rating, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(conversion_id) DO UPDATE SET
           rating = excluded.rating,
           updated_at = excluded.updated_at`,
      )
      .run(id, rating, Date.now());
    return rating;
  }

  getFeaturedId(): number | null {
    const row = this.db
      .prepare("SELECT conversion_id FROM publication_featured WHERE id = 1")
      .get() as { conversion_id: number } | undefined;
    return row?.conversion_id ?? null;
  }

  setFeatured(id: number | null): number | null {
    if (id === null) {
      this.db.prepare("DELETE FROM publication_featured WHERE id = 1").run();
      return null;
    }

    this.db
      .prepare(
        `INSERT INTO publication_featured (id, conversion_id, updated_at)
         VALUES (1, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           conversion_id = excluded.conversion_id,
           updated_at = excluded.updated_at`,
      )
      .run(id, Date.now());
    return id;
  }

  listSelected(): ConversionListItem[] {
    const rows = this.db
      .prepare(
        `SELECT ${LIST_COLUMNS}
         FROM conversions c
         JOIN prompts p ON p.id = c.prompt_id
         JOIN publication_selections s ON s.conversion_id = c.id
         LEFT JOIN publication_featured f ON f.conversion_id = c.id
         ORDER BY
           CASE s.rating WHEN 'nice' THEN 1 WHEN 'fair' THEN 2 ELSE 3 END,
           s.updated_at ASC,
           c.id ASC`,
      )
      .all() as unknown as ConversionRow[];
    return rows.map(toListItem);
  }

  selectionCounts(): SelectionCounts {
    const rows = this.db
      .prepare(
        `SELECT rating, COUNT(*) AS total
         FROM publication_selections
         GROUP BY rating`,
      )
      .all() as unknown as Array<{ rating: PublishRating; total: number }>;

    const counts: SelectionCounts = { nice: 0, fair: 0, bad: 0, total: 0 };
    for (const row of rows) {
      counts[row.rating] = row.total;
      counts.total += row.total;
    }
    return counts;
  }

  stats(): ConversionStats {
    const row = this.db
      .prepare(
        `SELECT
           COUNT(*) AS total,
           COALESCE(SUM(status = 'success'), 0) AS successes,
           COALESCE(SUM(status = 'error'), 0) AS errors,
           COALESCE(SUM(downsampled), 0) AS downsampled,
           COALESCE(AVG(latency_ms), 0) AS avg_latency_ms,
           COALESCE(AVG(total_tokens), 0) AS avg_tokens,
           COALESCE(SUM(total_tokens), 0) AS total_tokens,
           COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens,
           COALESCE(SUM(completion_tokens), 0) AS completion_tokens,
           COALESCE(SUM(cached_tokens), 0) AS cached_tokens,
           COALESCE(SUM(CASE WHEN cost_usd IS NOT NULL THEN prompt_tokens ELSE 0 END), 0)
             AS measured_prompt_tokens,
           COALESCE(SUM(CASE WHEN cost_usd IS NOT NULL THEN cached_tokens ELSE 0 END), 0)
             AS measured_cached_tokens,
           COALESCE(SUM(reasoning_tokens), 0) AS reasoning_tokens,
           COALESCE(SUM(cost_usd), 0) AS total_cost_usd,
           COALESCE(AVG(cost_usd), 0) AS avg_cost_usd,
           COALESCE(SUM(cost_usd IS NOT NULL), 0) AS costed
         FROM conversions`,
      )
      .get() as
      | {
          total: number;
          successes: number;
          errors: number;
          downsampled: number;
          avg_latency_ms: number;
          avg_tokens: number;
          total_tokens: number;
          prompt_tokens: number;
          completion_tokens: number;
          cached_tokens: number;
          measured_prompt_tokens: number;
          measured_cached_tokens: number;
          reasoning_tokens: number;
          total_cost_usd: number;
          avg_cost_usd: number;
          costed: number;
        }
      | undefined;

    const promptRows = this.db
      .prepare(
        `SELECT
           p.id AS prompt_id,
           p.version,
           COUNT(*) AS total,
           COALESCE(SUM(c.status = 'success'), 0) AS successes,
           COALESCE(SUM(c.status = 'error'), 0) AS errors,
           COALESCE(AVG(c.latency_ms), 0) AS avg_latency_ms,
           COALESCE(AVG(c.total_tokens), 0) AS avg_tokens,
           COALESCE(SUM(c.cost_usd), 0) AS total_cost_usd,
           COALESCE(AVG(c.cost_usd), 0) AS avg_cost_usd,
           COALESCE(SUM(c.cost_usd IS NOT NULL), 0) AS costed
         FROM conversions c
         JOIN prompts p ON p.id = c.prompt_id
         GROUP BY p.id
         ORDER BY p.created_at DESC`,
      )
      .all() as unknown as Array<{
      prompt_id: number;
      version: string;
      total: number;
      successes: number;
      errors: number;
      avg_latency_ms: number;
      avg_tokens: number;
      total_cost_usd: number;
      avg_cost_usd: number;
      costed: number;
    }>;

    const total = row?.total ?? 0;
    const successes = row?.successes ?? 0;
    const measuredPromptTokens = row?.measured_prompt_tokens ?? 0;
    const measuredCachedTokens = row?.measured_cached_tokens ?? 0;

    return {
      total,
      successes,
      errors: row?.errors ?? 0,
      successRate: total > 0 ? successes / total : 0,
      downsampled: row?.downsampled ?? 0,
      avgLatencyMs: row?.avg_latency_ms ?? 0,
      avgTokens: row?.avg_tokens ?? 0,
      totalTokens: row?.total_tokens ?? 0,
      promptTokens: row?.prompt_tokens ?? 0,
      completionTokens: row?.completion_tokens ?? 0,
      totalCostUsd: row?.total_cost_usd ?? 0,
      avgCostUsd: row?.avg_cost_usd ?? 0,
      costedConversions: row?.costed ?? 0,
      totalCachedTokens: row?.cached_tokens ?? 0,
      cacheHitRate:
        measuredPromptTokens > 0 ? measuredCachedTokens / measuredPromptTokens : 0,
      totalReasoningTokens: row?.reasoning_tokens ?? 0,
      prompts: promptRows.map((prompt) => ({
        promptId: prompt.prompt_id,
        version: prompt.version,
        total: prompt.total,
        successes: prompt.successes,
        errors: prompt.errors,
        avgLatencyMs: prompt.avg_latency_ms,
        avgTokens: prompt.avg_tokens,
        totalCostUsd: prompt.total_cost_usd,
        avgCostUsd: prompt.avg_cost_usd,
        costedConversions: prompt.costed,
      })),
    };
  }

  close(): void {
    this.db.close();
  }
}
