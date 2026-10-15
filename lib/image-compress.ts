// Browser-only image compression for uploaded photos. By default keeps each
// upload around 150-300KB so the Supabase free-tier storage lasts. Pass
// `maxBytes` for a hard ceiling: quality and then dimensions are reduced step
// by step until the JPEG fits.

const MAX_EDGE = 1200;
const QUALITY = 0.7;
const RETRY_QUALITY = 0.6;
const RETRY_ABOVE_BYTES = 400 * 1024;

// Hard-ceiling search: try these qualities at each size, then shrink the
// longest edge by EDGE_STEP until MIN_EDGE.
const CEILING_QUALITIES = [0.72, 0.62, 0.52, 0.42];
const EDGE_STEP = 0.8;
const MIN_EDGE = 320;
const FLOOR_QUALITY = 0.3;

export class ImageDecodeError extends Error {}

type Decoded = {
  source: CanvasImageSource;
  width: number;
  height: number;
  release: () => void;
};

function looksLikeHeic(file: File) {
  return /heic|heif/i.test(file.type) || /\.(heic|heif)$/i.test(file.name);
}

async function decode(file: File): Promise<Decoded> {
  if (typeof createImageBitmap === "function") {
    try {
      const bmp = await createImageBitmap(file, {
        imageOrientation: "from-image",
      });
      return {
        source: bmp,
        width: bmp.width,
        height: bmp.height,
        release: () => bmp.close(),
      };
    } catch {
      // Fall through to the <img> path (older Safari rejects the options arg).
    }
  }

  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    if (!img.naturalWidth || !img.naturalHeight) throw new Error("empty");
    return {
      source: img,
      width: img.naturalWidth,
      height: img.naturalHeight,
      release: () => URL.revokeObjectURL(url),
    };
  } catch {
    URL.revokeObjectURL(url);
    throw new ImageDecodeError(
      looksLikeHeic(file)
        ? `"${file.name}" is a HEIC photo this browser cannot read. On iPhone set Settings > Camera > Formats to "Most Compatible", or pick the photo from the Photos app instead of Files.`
        : `"${file.name}" could not be read as an image.`
    );
  }
}

function toJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Could not encode image."))),
      "image/jpeg",
      quality
    );
  });
}

// Draw the decoded image onto a canvas whose longest edge is at most `edge`.
function draw(img: Decoded, canvas: HTMLCanvasElement, edge: number) {
  const scale = Math.min(1, edge / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not available in this browser.");
  // White backdrop so transparent PNGs do not turn black as JPEG.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img.source, 0, 0, w, h);
}

export class ImageTooLargeError extends Error {}

export async function compressImage(
  file: File,
  opts: { maxBytes?: number } = {}
): Promise<Blob> {
  const img = await decode(file);
  const canvas = document.createElement("canvas");
  try {
    let edge = MAX_EDGE;
    draw(img, canvas, edge);

    if (!opts.maxBytes) {
      let blob = await toJpeg(canvas, QUALITY);
      if (blob.size > RETRY_ABOVE_BYTES) blob = await toJpeg(canvas, RETRY_QUALITY);
      return blob;
    }

    const limit = opts.maxBytes;
    for (;;) {
      for (const q of CEILING_QUALITIES) {
        const blob = await toJpeg(canvas, q);
        if (blob.size <= limit) return blob;
      }
      if (edge <= MIN_EDGE) break;
      edge = Math.max(MIN_EDGE, Math.round(edge * EDGE_STEP));
      draw(img, canvas, edge);
    }
    const last = await toJpeg(canvas, FLOOR_QUALITY);
    if (last.size <= limit) return last;
    throw new ImageTooLargeError(
      `"${file.name}" could not be compressed under ${Math.round(limit / 1024)}KB.`
    );
  } finally {
    canvas.width = 0;
    canvas.height = 0;
    img.release();
  }
}
