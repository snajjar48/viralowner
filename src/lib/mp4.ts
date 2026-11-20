import "server-only";

// Reads an MP4/MOV's duration straight from its header boxes, using a few
// small range reads (no ffmpeg, no full download). Works whether the "moov"
// header is at the start of the file or at the end (as on most phones), and for
// "fragmented" MP4s (common for videos saved from other apps), whose length is
// in an extension box (mehd) or a segment index (sidx) instead, or nowhere.

type ReadRange = (start: number, end: number) => Promise<Uint8Array>;

const TOP_LEVEL = new Set([
  "ftyp", "wide", "free", "skip", "mdat", "moov", "pnot", "uuid", "meta",
  // fragmented MP4s
  "styp", "sidx", "ssix", "moof", "mfra", "emsg", "prft",
]);

const view = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);
const fourcc = (b: Uint8Array, at: number) => String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3]);

/**
 * Duration in seconds; 0 for a real MP4/MOV whose length isn't written in its headers (a fragmented
 * file with no index: use the length the device reported); null if this isn't a readable MP4/MOV.
 */
export async function readMp4Duration(read: ReadRange, fileSize: number): Promise<number | null> {
  let offset = 0;
  let sawMoov = false;
  for (let i = 0; i < 64 && offset + 8 <= fileSize; i++) {
    const head = await read(offset, Math.min(offset + 15, fileSize - 1));
    if (head.length < 8) break;
    let size = view(head).getUint32(0);
    const type = fourcc(head, 4);
    if (!TOP_LEVEL.has(type)) break; // not an MP4/MOV (or corrupt, or past what we know)
    let headerSize = 8;
    if (size === 1) {
      if (head.length < 16) break;
      size = Number(view(head).getBigUint64(8));
      headerSize = 16;
    } else if (size === 0) {
      size = fileSize - offset; // box runs to the end of the file
    }
    if (size < headerSize) break;

    if (type === "moov") {
      // mvhd is near the start of moov; mvex (fragmented files) is after the tracks, so read it all
      // when it's small (it is for fragmented files: no sample tables), else the first 64 KB.
      const moov = await read(offset + headerSize, Math.min(offset + size, offset + headerSize + 256 * 1024) - 1);
      const d = parseMoov(moov);
      if (d === null) return null;
      if (d > 0) return d;
      sawMoov = true; // fragmented: look for a segment index next
    } else if (type === "sidx" && sawMoov) {
      const sidx = await read(offset + headerSize, Math.min(offset + size, offset + headerSize + 65536) - 1);
      const d = parseSidx(sidx);
      if (d) return d;
    } else if (type === "moof" && sawMoov) {
      break; // the fragments themselves: no index before them
    }
    offset += size;
  }
  return sawMoov ? 0 : null;
}

/** mvhd's duration (or mvex/mehd's, for fragmented files); 0 when neither has one; null if no mvhd. */
function parseMoov(moov: Uint8Array): number | null {
  let timescale = 0;
  let duration = 0;
  let mehd = 0;
  let at = 0;
  while (at + 8 <= moov.length) {
    const size = view(moov).getUint32(at);
    const type = fourcc(moov, at + 4);
    if (type === "mvhd") {
      const d = view(moov);
      const version = moov[at + 8];
      const body = at + 12; // after header (8) + version/flags (4)
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
      if (duration > 0 && duration !== 0xffffffff) return duration / timescale;
    } else if (type === "mvex") {
      mehd = parseMehd(moov.subarray(at + 8, Math.min(moov.length, at + size)));
    }
    if (size < 8) break;
    at += size;
  }
  if (!timescale) return null;
  return mehd > 0 ? mehd / timescale : 0;
}

function parseMehd(mvex: Uint8Array): number {
  let at = 0;
  while (at + 8 <= mvex.length) {
    const size = view(mvex).getUint32(at);
    if (fourcc(mvex, at + 4) === "mehd") {
      const version = mvex[at + 8];
      const body = at + 12;
      if (version === 1) return body + 8 <= mvex.length ? Number(view(mvex).getBigUint64(body)) : 0;
      return body + 4 <= mvex.length ? view(mvex).getUint32(body) : 0;
    }
    if (size < 8) break;
    at += size;
  }
  return 0;
}

/** Total length from a segment index (sidx body, after its 8-byte header), in seconds; 0 if unreadable. */
function parseSidx(b: Uint8Array): number {
  if (b.length < 12) return 0;
  const d = view(b);
  const version = b[0];
  const timescale = d.getUint32(8);
  let at = 12 + (version === 0 ? 8 : 16) + 2; // earliest_presentation_time + first_offset, reserved
  if (!timescale || at + 2 > b.length) return 0;
  const count = d.getUint16(at);
  at += 2;
  let total = 0;
  for (let i = 0; i < count && at + 12 <= b.length; i++, at += 12) total += d.getUint32(at + 4);
  return total / timescale;
}

/** For the logs: the file's first bytes and its top-level boxes (type@offset:size), when it can't be read. */
export async function describeMp4(read: ReadRange, fileSize: number): Promise<string> {
  const out: string[] = [];
  try {
    const first = await read(0, Math.min(31, fileSize - 1));
    out.push(`size=${fileSize} head=${Buffer.from(first).toString("hex")}`);
    let offset = 0;
    for (let i = 0; i < 24 && offset + 8 <= fileSize; i++) {
      const head = await read(offset, Math.min(offset + 15, fileSize - 1));
      let size = view(head).getUint32(0);
      const type = fourcc(head, 4).replace(/[^\x20-\x7e]/g, "?");
      if (size === 1 && head.length >= 16) size = Number(view(head).getBigUint64(8));
      else if (size === 0) size = fileSize - offset;
      out.push(`${type}@${offset}:${size}`);
      if (size < 8) break;
      offset += size;
    }
  } catch (error) {
    out.push(`error=${error instanceof Error ? error.message : String(error)}`);
  }
  return out.join(" ");
}
