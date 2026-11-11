import "server-only";

// Reads an MP4/MOV's duration straight from its header boxes, using a few
// small range reads (no ffmpeg, no full download). Works whether the "moov"
// header is at the start of the file or at the end (as on most phones).

type ReadRange = (start: number, end: number) => Promise<Uint8Array>;

const TOP_LEVEL = new Set(["ftyp", "wide", "free", "skip", "mdat", "moov", "pnot", "uuid", "meta"]);

const view = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);
const fourcc = (b: Uint8Array, at: number) => String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3]);

/** Duration in seconds, or null if this isn't a readable MP4/MOV. */
export async function readMp4Duration(read: ReadRange, fileSize: number): Promise<number | null> {
  let offset = 0;
  for (let i = 0; i < 64 && offset + 8 <= fileSize; i++) {
    const head = await read(offset, Math.min(offset + 15, fileSize - 1));
    if (head.length < 8) return null;
    let size = view(head).getUint32(0);
    const type = fourcc(head, 4);
    if (!TOP_LEVEL.has(type)) return null; // not an MP4/MOV (or corrupt)
    let headerSize = 8;
    if (size === 1) {
      if (head.length < 16) return null;
      size = Number(view(head).getBigUint64(8));
      headerSize = 16;
    } else if (size === 0) {
      size = fileSize - offset; // box runs to the end of the file
    }
    if (size < headerSize) return null;

    if (type === "moov") {
      // mvhd is near the start of moov; 64 KB is plenty.
      const moov = await read(offset + headerSize, Math.min(offset + size, offset + headerSize + 65536) - 1);
      return parseMvhd(moov);
    }
    offset += size;
  }
  return null;
}

function parseMvhd(moov: Uint8Array): number | null {
  let at = 0;
  while (at + 8 <= moov.length) {
    const size = view(moov).getUint32(at);
    if (fourcc(moov, at + 4) === "mvhd") {
      const d = view(moov);
      const version = moov[at + 8];
      const body = at + 12; // after header (8) + version/flags (4)
      let timescale: number, duration: number;
      if (version === 1) {
        if (body + 28 > moov.length) return null;
        timescale = d.getUint32(body + 16);
        duration = Number(d.getBigUint64(body + 20));
      } else {
        if (body + 16 > moov.length) return null;
        timescale = d.getUint32(body + 8);
        duration = d.getUint32(body + 12);
      }
      if (!timescale) return null;
      return duration / timescale;
    }
    if (size < 8) return null;
    at += size;
  }
  return null;
}
