import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { normalizeImage } from "../src/services/image.js";

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_DIMENSION = 1568;

async function makeImage(
  width: number,
  height: number,
  format: "png" | "jpeg" = "png",
): Promise<Buffer> {
  const pipeline = sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 10, g: 20, b: 30 },
    },
  });
  return format === "png" ? pipeline.png().toBuffer() : pipeline.jpeg().toBuffer();
}

describe("normalizeImage", () => {
  it("downscales an image that exceeds the max dimension", async () => {
    const input = await makeImage(3000, 2000);

    const result = await normalizeImage(input, {
      maxBytes: MAX_BYTES,
      maxDimension: MAX_DIMENSION,
    });

    expect(result.resized).toBe(true);
    expect(result.originalWidth).toBe(3000);
    expect(result.originalHeight).toBe(2000);
    expect(Math.max(result.width, result.height)).toBe(MAX_DIMENSION);
    expect(result.width / result.height).toBeCloseTo(1.5, 2);
    expect(result.dataUrl.startsWith("data:image/jpeg;base64,")).toBe(true);
  });

  it("does not enlarge an image smaller than the max dimension", async () => {
    const input = await makeImage(100, 80);

    const result = await normalizeImage(input, {
      maxBytes: MAX_BYTES,
      maxDimension: MAX_DIMENSION,
    });

    expect(result.resized).toBe(false);
    expect(result.originalWidth).toBe(100);
    expect(result.originalHeight).toBe(80);
    expect(result.width).toBe(100);
    expect(result.height).toBe(80);
  });

  it("preserves alpha by encoding as PNG", async () => {
    const input = await sharp({
      create: {
        width: 200,
        height: 200,
        channels: 4,
        background: { r: 255, g: 0, b: 0, alpha: 0.5 },
      },
    })
      .png()
      .toBuffer();

    const result = await normalizeImage(input, {
      maxBytes: MAX_BYTES,
      maxDimension: MAX_DIMENSION,
    });

    expect(result.mime).toBe("image/png");
    expect(result.dataUrl.startsWith("data:image/png;base64,")).toBe(true);
  });

  it("rejects an image above the byte limit", async () => {
    const input = await makeImage(100, 100);

    await expect(
      normalizeImage(input, { maxBytes: 10, maxDimension: MAX_DIMENSION }),
    ).rejects.toMatchObject({ code: "payload_too_large", statusCode: 413 });
  });
});
