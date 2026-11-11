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
