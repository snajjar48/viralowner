import "server-only";
import { AwsClient } from "aws4fetch";

// Cloudflare R2 (S3-compatible). The bucket is private: browsers upload and
// download with short-lived signed URLs, so video bytes never pass through
// Vercel.

function config() {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET;
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
    throw new Error("Storage is not configured (R2_* env vars, see .env.example).");
  }
  return { accountId, accessKeyId, secretAccessKey, bucket };
}

let client: AwsClient | null = null;
function r2() {
  const c = config();
  client ??= new AwsClient({
    accessKeyId: c.accessKeyId,
    secretAccessKey: c.secretAccessKey,
    service: "s3",
    region: "auto",
  });
  return { client, base: `https://${c.accountId}.r2.cloudflarestorage.com/${c.bucket}` };
}

function objectUrl(key: string) {
  const { base } = r2();
  return `${base}/${key.split("/").map(encodeURIComponent).join("/")}`;
}

/**
 * A URL the browser can PUT one file to.
 *
 * Only the URL itself is signed, not the file's size or type: phones (iPhones
 * picking from Photos especially) can send slightly different bytes or headers
 * than they reported, and R2 answers a signature mismatch without CORS headers,
 * which the browser shows as a vague "network error". The server checks the
 * stored file's real size, type and length after upload instead
 * (completeInspo / completeClip) and deletes anything that doesn't pass.
 */
export async function createUploadUrl(
  key: string,
  { contentType, expiresIn = 3600 }: { contentType: string; sizeBytes: number; expiresIn?: number },
) {
  const url = new URL(objectUrl(key));
  url.searchParams.set("X-Amz-Expires", String(expiresIn));
  const signed = await r2().client.sign(url.toString(), { method: "PUT", aws: { signQuery: true } });
  // Sent (not signed) so storage records the type.
  return { url: signed.url, headers: { "content-type": contentType } };
}

// ---- Big files upload in parts, several at once (much faster than one long upload).

/** Every part but the last is this size (R2 needs them equal, and at least 5 MB). */
export const UPLOAD_PART_BYTES = 8 * 1024 * 1024;
/** Files at least this big upload in parts; smaller ones in one go. */
export const MULTIPART_MIN_BYTES = 16 * 1024 * 1024;

const xmlValue = (xml: string, tag: string) => new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(xml)?.[1] ?? null;

/**
 * Starts a multipart upload and signs a PUT URL for every part. The browser uploads the parts
 * (any order, several at once), then the server finishes it (completeMultipartUpload).
 */
export async function createMultipartUpload(
  key: string,
  { contentType, sizeBytes, expiresIn = 4 * 3600 }: { contentType: string; sizeBytes: number; expiresIn?: number },
) {
  const res = await r2().client.fetch(`${objectUrl(key)}?uploads=`, {
    method: "POST",
    headers: { "content-type": contentType },
  });
  const xml = await res.text();
  const uploadId = xmlValue(xml, "UploadId");
  if (!res.ok || !uploadId) throw new Error(`Storage multipart start failed (${res.status})`);
  const count = Math.max(1, Math.ceil(sizeBytes / UPLOAD_PART_BYTES));
  const urls = await Promise.all(
    Array.from({ length: count }, async (_, i) => {
      const url = new URL(objectUrl(key));
      url.searchParams.set("partNumber", String(i + 1));
      url.searchParams.set("uploadId", uploadId);
      url.searchParams.set("X-Amz-Expires", String(expiresIn));
      return (await r2().client.sign(url.toString(), { method: "PUT", aws: { signQuery: true } })).url;
    }),
  );
  return { uploadId, partBytes: UPLOAD_PART_BYTES, urls };
}

/** Joins the uploaded parts into the file. The parts' ETags come from storage, not the browser. */
export async function completeMultipartUpload(key: string, uploadId: string) {
  const list = await r2().client.fetch(`${objectUrl(key)}?uploadId=${encodeURIComponent(uploadId)}&max-parts=1000`);
  const xml = await list.text();
  // Already joined (a retry after it worked): the file is there.
  if (list.status === 404 && (await headObject(key))) return;
  if (!list.ok) throw new Error(`Storage list parts failed (${list.status})`);
  const parts = [...xml.matchAll(/<Part>([\s\S]*?)<\/Part>/g)].map((m) => ({
    n: Number(xmlValue(m[1], "PartNumber")),
    etag: xmlValue(m[1], "ETag") ?? "",
  }));
  if (!parts.length) throw new Error("No parts were uploaded");
  parts.sort((a, b) => a.n - b.n);
  const body =
    "<CompleteMultipartUpload>" +
    parts.map((p) => `<Part><PartNumber>${p.n}</PartNumber><ETag>${p.etag}</ETag></Part>`).join("") +
    "</CompleteMultipartUpload>";
  const res = await r2().client.fetch(`${objectUrl(key)}?uploadId=${encodeURIComponent(uploadId)}`, {
    method: "POST",
    headers: { "content-type": "application/xml" },
    body,
  });
  const out = await res.text();
  if (!res.ok || out.includes("<Error>")) throw new Error(`Storage multipart complete failed (${res.status}): ${out.slice(0, 200)}`);
}

/** A URL to view or download a file. `downloadName` makes browsers save it. */
export async function createDownloadUrl(
  key: string,
  { expiresIn = 3600, downloadName }: { expiresIn?: number; downloadName?: string } = {},
) {
  const url = new URL(objectUrl(key));
  url.searchParams.set("X-Amz-Expires", String(expiresIn));
  if (downloadName) {
    url.searchParams.set(
      "response-content-disposition",
      `attachment; filename="${downloadName.replace(/[^\w.\- ]/g, "_")}"`,
    );
  }
  const signed = await r2().client.sign(url.toString(), { method: "GET", aws: { signQuery: true } });
  return signed.url;
}

/** Size and type of a stored file, or null if it doesn't exist. */
export async function headObject(key: string) {
  const res = await r2().client.fetch(objectUrl(key), { method: "HEAD" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Storage HEAD failed (${res.status})`);
  return {
    sizeBytes: Number(res.headers.get("content-length") ?? 0),
    contentType: res.headers.get("content-type") ?? "",
  };
}

/** Reads bytes [start, end] (inclusive) of a stored file. */
export async function readRange(key: string, start: number, end: number) {
  const res = await r2().client.fetch(objectUrl(key), { headers: { range: `bytes=${start}-${end}` } });
  if (!res.ok) throw new Error(`Storage range read failed (${res.status})`);
  return new Uint8Array(await res.arrayBuffer());
}

export async function putObject(key: string, body: Uint8Array, contentType: string) {
  // Sign first, then send the raw bytes ourselves. Passing aws4fetch's signed
  // Request straight to Next.js's fetch streams the body without a
  // content-length, which R2 rejects (411).
  const signed = await r2().client.sign(objectUrl(key), {
    method: "PUT",
    headers: { "content-type": contentType },
    body: body as BodyInit,
  });
  const res = await fetch(signed.url, { method: "PUT", headers: signed.headers, body: body as BodyInit });
  if (!res.ok) throw new Error(`Storage PUT failed (${res.status})`);
}

export async function deleteObject(key: string) {
  const res = await r2().client.fetch(objectUrl(key), { method: "DELETE" });
  if (!res.ok && res.status !== 404) throw new Error(`Storage DELETE failed (${res.status})`);
}
