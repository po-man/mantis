import { existsSync } from "node:fs";
import { z } from "zod";

// Load .env when present. Existing environment variables win.
if (existsSync(".env")) {
  try {
    process.loadEnvFile(".env");
  } catch {
    // Ignore malformed .env files; validation below reports real problems.
  }
}

const optionalString = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().optional(),
);

// OpenRouter normalizes effort to a reasoning-token budget; the exact set of
// supported values depends on the model.
const reasoningEffort = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z
    .enum(["none", "minimal", "low", "medium", "high", "max"])
    .optional(),
);

export type ReasoningEffort = z.infer<typeof reasoningEffort>;

const booleanString = z.preprocess((value) => {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "") {
      return undefined;
    }
    if (["1", "true", "yes", "on"].includes(normalized)) {
      return true;
    }
    if (["0", "false", "no", "off"].includes(normalized)) {
      return false;
    }
  }
  return value;
}, z.boolean());

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(8080),
  HOST: z.string().min(1).default("0.0.0.0"),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),

  OPENROUTER_API_KEY: z.string().min(1, "OPENROUTER_API_KEY is required"),
  OPENROUTER_MODEL: z.string().min(1, "OPENROUTER_MODEL is required"),
  OPENROUTER_BASE_URL: z.string().url().default("https://openrouter.ai/api/v1"),
  OPENROUTER_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.2),
  OPENROUTER_MAX_TOKENS: z.coerce.number().int().positive().default(16_384),
  OPENROUTER_REASONING_EFFORT: reasoningEffort,
  OPENROUTER_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
  OPENROUTER_HTTP_REFERER: optionalString,
  OPENROUTER_APP_TITLE: z.string().min(1).default("vector"),
  OPENROUTER_PROVIDER: optionalString,

  PROMPT_VERSION: z.string().trim().min(1, "PROMPT_VERSION is required"),
  PROMPT_DIR: z.string().min(1).default("prompts"),
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(10 * 1024 * 1024),
  MAX_IMAGE_DIMENSION: z.coerce.number().int().positive().default(1568),
  MAX_CONCURRENCY: z.coerce.number().int().positive().default(4),
  MAX_QUEUE: z.coerce.number().int().min(0).default(32),
  RETRY_ON_INVALID_SVG: z.coerce.number().int().min(0).max(3).default(1),
  REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(150_000),

  DATABASE_PATH: z.string().min(1).default("data/vector.db"),
  REVIEW_UI_ENABLED: booleanString.default(true),
});

export interface Config {
  nodeEnv: "development" | "test" | "production";
  port: number;
  host: string;
  logLevel: string;

  openrouterApiKey: string;
  openrouterModel: string;
  openrouterBaseUrl: string;
  openrouterTemperature: number;
  openrouterMaxTokens: number;
  /** OpenRouter `reasoning.effort`; unset keeps the model default. */
  openrouterReasoningEffort?: ReasoningEffort;
  openrouterTimeoutMs: number;
  openrouterHttpReferer?: string;
  openrouterAppTitle: string;
  openrouterProvider?: string;

  promptVersion: string;
  promptDir: string;
  maxUploadBytes: number;
  maxImageDimension: number;
  maxConcurrency: number;
  maxQueue: number;
  retryOnInvalidSvg: number;
  requestTimeoutMs: number;

  databasePath: string;
  reviewUiEnabled: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid configuration: ${issues}`);
  }

  const value = parsed.data;
  return {
    nodeEnv: value.NODE_ENV,
    port: value.PORT,
    host: value.HOST,
    logLevel: value.LOG_LEVEL,

    openrouterApiKey: value.OPENROUTER_API_KEY,
    openrouterModel: value.OPENROUTER_MODEL,
    openrouterBaseUrl: value.OPENROUTER_BASE_URL,
    openrouterTemperature: value.OPENROUTER_TEMPERATURE,
    openrouterMaxTokens: value.OPENROUTER_MAX_TOKENS,
    openrouterReasoningEffort: value.OPENROUTER_REASONING_EFFORT,
    openrouterTimeoutMs: value.OPENROUTER_TIMEOUT_MS,
    openrouterHttpReferer: value.OPENROUTER_HTTP_REFERER,
    openrouterAppTitle: value.OPENROUTER_APP_TITLE,
    openrouterProvider: value.OPENROUTER_PROVIDER,

    promptVersion: value.PROMPT_VERSION,
    promptDir: value.PROMPT_DIR,
    maxUploadBytes: value.MAX_UPLOAD_BYTES,
    maxImageDimension: value.MAX_IMAGE_DIMENSION,
    maxConcurrency: value.MAX_CONCURRENCY,
    maxQueue: value.MAX_QUEUE,
    retryOnInvalidSvg: value.RETRY_ON_INVALID_SVG,
    requestTimeoutMs: value.REQUEST_TIMEOUT_MS,

    databasePath: value.DATABASE_PATH,
    reviewUiEnabled: value.REVIEW_UI_ENABLED,
  };
}
