import sharp from 'sharp';

const TARGET_W = 1200;
const TARGET_H = 1500; // 4:5 — matches storefront product cards

/**
 * Center product on a pure white 4:5 canvas and emit web-optimized JPEG.
 * Trims empty / near-white margins first so the garment fills the frame,
 * then scales up to ~90% of the canvas (enlargement allowed).
 */
export async function standardizeToWhiteCanvas(
  input: Buffer,
): Promise<{ buffer: Buffer; mime: string; width: number; height: number }> {
  // Flatten any alpha onto white, then trim pale margins so subject fills frame
  const flattened = await sharp(input, { failOn: 'none' })
    .rotate() // honor EXIF orientation
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .png()
    .toBuffer();

  let subject = flattened;
  try {
    subject = await sharp(flattened, { failOn: 'none' })
      .trim({
        background: { r: 255, g: 255, b: 255 },
        threshold: 18,
      })
      .png()
      .toBuffer();
  } catch {
    // trim can fail on uniform images — keep flattened
    subject = flattened;
  }

  const meta = await sharp(subject, { failOn: 'none' }).metadata();
  const srcW = Math.max(1, meta.width ?? TARGET_W);
  const srcH = Math.max(1, meta.height ?? TARGET_H);

  // ~5% padding each side — product should dominate the frame
  const padRatio = 0.05;
  const maxW = Math.round(TARGET_W * (1 - padRatio * 2));
  const maxH = Math.round(TARGET_H * (1 - padRatio * 2));
  // Allow enlargement so small/phone crops still fill the canvas
  const scale = Math.min(maxW / srcW, maxH / srcH);
  const drawW = Math.max(1, Math.round(srcW * scale));
  const drawH = Math.max(1, Math.round(srcH * scale));

  const resized = await sharp(subject, { failOn: 'none' })
    .resize(drawW, drawH, {
      fit: 'fill',
      kernel: sharp.kernel.lanczos3,
    })
    .png()
    .toBuffer();

  const left = Math.floor((TARGET_W - drawW) / 2);
  const top = Math.floor((TARGET_H - drawH) / 2);

  const buffer = await sharp({
    create: {
      width: TARGET_W,
      height: TARGET_H,
      channels: 3,
      background: { r: 255, g: 255, b: 255 },
    },
  })
    .composite([{ input: resized, left, top }])
    .jpeg({ quality: 88, mozjpeg: true })
    .sharpen({ sigma: 0.5 })
    .toBuffer();

  return {
    buffer,
    mime: 'image/jpeg',
    width: TARGET_W,
    height: TARGET_H,
  };
}
