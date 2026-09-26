// Browser-only image compression for task photos. Keeps each upload around
// 150-300KB so the Supabase free-tier storage lasts.

const MAX_EDGE = 1200;
const QUALITY = 0.7;
const RETRY_QUALITY = 0.6;
const RETRY_ABOVE_BYTES = 400 * 1024;

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

export async function compressImage(file: File): Promise<Blob> {
  const img = await decode(file);
  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas is not available in this browser.");
    // White backdrop so transparent PNGs do not turn black as JPEG.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img.source, 0, 0, w, h);

    let blob = await toJpeg(canvas, QUALITY);
    if (blob.size > RETRY_ABOVE_BYTES) blob = await toJpeg(canvas, RETRY_QUALITY);
    canvas.width = 0;
    canvas.height = 0;
    return blob;
  } finally {
    img.release();
  }
}
