// A small reader for .zip files (a .docx is a zip). No package needed: the caller gives the
// "inflate" (deflate-raw) step: the browser's DecompressionStream, or node:zlib in tests.
// Reads only what is asked for, so the 120 MB SOP file is not unpacked whole.

export type Inflate = (data: Uint8Array) => Promise<Uint8Array>;

export interface ZipEntry {
  name: string;
  method: number; // 0 = stored, 8 = deflate
  compressedSize: number;
  size: number;
  localOffset: number;
}

const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const u32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

export function listZip(buf: Uint8Array): ZipEntry[] {
  // End of central directory: the last record, signature PK\5\6, within the last 64 KB
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (u32(buf, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("This is not a Word (.docx) file.");
  const count = u16(buf, eocd + 10);
  let p = u32(buf, eocd + 16);
  if (p === 0xffffffff || count === 0xffff) throw new Error("This file is too large to read (zip64).");
  const out: ZipEntry[] = [];
  const dec = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (u32(buf, p) !== 0x02014b50) throw new Error("The file is damaged (zip directory).");
    const nameLen = u16(buf, p + 28);
    const extraLen = u16(buf, p + 30);
    const commentLen = u16(buf, p + 32);
    out.push({
      method: u16(buf, p + 10),
      compressedSize: u32(buf, p + 20),
      size: u32(buf, p + 24),
      localOffset: u32(buf, p + 42),
      name: dec.decode(buf.subarray(p + 46, p + 46 + nameLen)),
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

export async function readZipEntry(buf: Uint8Array, e: ZipEntry, inflate: Inflate): Promise<Uint8Array> {
  const o = e.localOffset;
  if (u32(buf, o) !== 0x04034b50) throw new Error(`The file is damaged (${e.name}).`);
  const start = o + 30 + u16(buf, o + 26) + u16(buf, o + 28);
  const data = buf.subarray(start, start + e.compressedSize);
  if (e.method === 0) return data;
  if (e.method === 8) return inflate(data);
  throw new Error(`Unsupported compression in ${e.name}.`);
}

// The parts of a .docx the import needs, as text (XML) and bytes (images).
export interface DocxParts {
  document: string;
  rels: string;
  numbering: string;
  media: Map<string, Uint8Array>; // "media/image1.png" -> bytes
}

export async function readDocx(buf: Uint8Array, inflate: Inflate): Promise<DocxParts> {
  const entries = listZip(buf);
  const by = new Map(entries.map((e) => [e.name, e]));
  const text = async (name: string) => {
    const e = by.get(name);
    return e ? new TextDecoder().decode(await readZipEntry(buf, e, inflate)) : "";
  };
  const document = await text("word/document.xml");
  if (!document) throw new Error("This Word file has no document inside (word/document.xml).");
  const media = new Map<string, Uint8Array>();
  for (const e of entries) {
    if (e.name.startsWith("word/media/")) media.set(e.name.slice(5), await readZipEntry(buf, e, inflate));
  }
  return { document, rels: await text("word/_rels/document.xml.rels"), numbering: await text("word/numbering.xml"), media };
}
