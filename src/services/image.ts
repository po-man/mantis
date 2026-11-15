import { fileTypeFromBuffer } from "file-type";
import sharp, { type Metadata } from "sharp";
import { AppError } from "../lib/errors.js";

const ALLOWED_MIME = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAX_INPUT_PIXELS = 50_000_000;

export interface NormalizedImage {
  dataUrl: string;
  mime: "image/png" | "image/jpeg";
  width: number;
  height: number;
  bytes: number;
  originalWidth: number;
  originalHeight: number;
  resized: boolean;
}

export interface NormalizeImageOptions {
  maxBytes: number;
  maxDimension: number;
}

/**
 * Accepts a data URL or a bare base64 string and returns the decoded bytes.
 */
export function decodeImagePayload(value: string): Buffer {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new AppError("bad_request", "Image payload is empty", 400);
  }

  const dataUrl = /^data:[^,]*;base64,(.*)$/is.exec(trimmed);
  const base64 = (dataUrl?.[1] ?? trimmed).replace(/\s+/g, "");

  if (base64.length === 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
    throw new AppError("bad_request", "Image payload is not valid base64", 400);
  }

  const buffer = Buffer.from(base64, "base64");
  if (buffer.length === 0) {
    throw new AppError("bad_request", "Image payload decoded to zero bytes", 400);
  }
  return buffer;
}

/**
 * Validates the image by magic bytes, normalizes orientation/color space,
 * downscales it, and re-encodes it for the upstream VLM.
 */
export async function normalizeImage(
  input: Buffer,
  options: NormalizeImageOptions,
): Promise<NormalizedImage> {
  if (input.length === 0) {
    throw new AppError("invalid_image", "Image is empty", 400);
  }
  if (input.length > options.maxBytes) {
    throw new AppError(
      "payload_too_large",
      `Image exceeds the ${options.maxBytes} byte limit`,
      413,
    );
  }

  const detected = await fileTypeFromBuffer(input);
  if (!detected || !ALLOWED_MIME.has(detected.mime)) {
    throw new AppError(
      "unsupported_media_type",
      "Only PNG, JPEG, and WebP images are supported",
      415,
    );
  }

  let metadata: Metadata;
  try {
    metadata = await sharp(input, {
      failOn: "error",
      limitInputPixels: MAX_INPUT_PIXELS,
    }).metadata();
  } catch {
    throw new AppError("invalid_image", "Image could not be decoded", 400);
  }

  if (!metadata.width || !metadata.height) {
    throw new AppError("invalid_image", "Image dimensions could not be read", 400);
  }

  const sourceWidth = metadata.width;
  const sourceHeight = metadata.height;

  // EXIF orientations 5-8 rotate the image by 90 degrees, swapping the axes.
  const orientation = metadata.orientation ?? 1;
  const swapsAxes = orientation >= 5 && orientation <= 8;
  const originalWidth = swapsAxes ? sourceHeight : sourceWidth;
  const originalHeight = swapsAxes ? sourceWidth : sourceHeight;
  const resized = Math.max(originalWidth, originalHeight) > options.maxDimension;

  const hasAlpha = Boolean(metadata.hasAlpha);
  const pipeline = sharp(input, {
    failOn: "error",
    limitInputPixels: MAX_INPUT_PIXELS,
  })
    .rotate()
    .toColorspace("srgb")
    .resize({
      width: options.maxDimension,
      height: options.maxDimension,
      fit: "inside",
      withoutEnlargement: true,
    });

  let output: Buffer;
  try {
    output = hasAlpha
      ? await pipeline.png({ compressionLevel: 9 }).toBuffer()
      : await pipeline.jpeg({ quality: 85, mozjpeg: true }).toBuffer();
  } catch {
    throw new AppError("invalid_image", "Image could not be processed", 400);
  }

  const outputMetadata = await sharp(output).metadata();
  const mime = hasAlpha ? "image/png" : "image/jpeg";

  return {
    dataUrl: `data:${mime};base64,${output.toString("base64")}`,
    mime,
    width: outputMetadata.width ?? originalWidth,
    height: outputMetadata.height ?? originalHeight,
    bytes: output.length,
    originalWidth,
    originalHeight,
    resized,
  };
}
