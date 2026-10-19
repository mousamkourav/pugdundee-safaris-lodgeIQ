// Browser-only: turns a full-size camera photo into a web copy.
// 1600 px on the long side, WebP (JPEG where WebP is not available), about
// 150-350 KB. The original file never leaves the computer.

export class PhotoReadError extends Error {}

export async function compressPhoto(file: File, maxSide = 1600): Promise<Blob> {
  let bmp: ImageBitmap;
  try {
    // Respect the camera's rotation flag so portrait shots stay upright.
    bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new PhotoReadError(`"${file.name}" could not be read as a photo.`);
  }
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext("2d");
  if (!g) {
    bmp.close();
    throw new PhotoReadError("This browser cannot resize photos.");
  }
  g.imageSmoothingQuality = "high";
  g.drawImage(bmp, 0, 0, w, h);
  bmp.close();

  const encode = (type: string, quality: number) =>
    new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), type, quality));

  // WebP first; if the browser cannot make WebP it returns PNG, so fall back to JPEG.
  let out = await encode("image/webp", 0.82);
  if (!out || out.type !== "image/webp") out = await encode("image/jpeg", 0.85);
  if (out && out.size > 450_000) out = (await encode(out.type, 0.7)) ?? out; // very detailed scenes
  canvas.width = canvas.height = 0; // free the memory straight away
  if (!out) throw new PhotoReadError(`"${file.name}" could not be compressed.`);
  return out;
}
