import "server-only";
import { siteUrl } from "./site-url";

// Sends email through Resend (https://resend.com/docs/api-reference/emails/send-email).
// The viralowner.com domain is verified there; RESEND_API_KEY is in Vercel.

const FROM = process.env.EMAIL_FROM ?? "viralowner <hello@viralowner.com>";

export interface Email {
  to: string;
  subject: string;
  /** Short preview line shown after the subject in most inboxes. */
  preview: string;
  heading: string;
  /** Paragraphs of plain text (escaped for the HTML version). */
  body: string[];
  button?: { label: string; href: string };
  /** Plain-text footnote under the button. */
  footnote?: string;
}

/**
 * Sends one email. Never throws: a failed email is logged and must not break
 * whatever triggered it. `idempotencyKey` makes Resend drop repeats (for 24h),
 * e.g. when both the browser and a webhook report the same event.
 */
export async function sendEmail(email: Email, idempotencyKey?: string): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.error("Email not sent: RESEND_API_KEY is not set.");
    return false;
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
        ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
      },
      body: JSON.stringify({
        from: FROM,
        to: [email.to],
        subject: email.subject,
        html: toHtml(email),
        text: toText(email),
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      console.error(`Email "${email.subject}" failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
      return false;
    }
    return true;
  } catch (error) {
    console.error(`Email "${email.subject}" failed:`, error);
    return false;
  }
}

const escape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function toText(e: Email) {
  return [
    e.heading,
    "",
    ...e.body.flatMap((p) => [p, ""]),
    ...(e.button ? [`${e.button.label}: ${e.button.href}`, ""] : []),
    ...(e.footnote ? [e.footnote, ""] : []),
    "viralowner · your spin. viral reach. zero editing.",
    siteUrl(),
  ].join("\n");
}

// Table layout with inline styles: what email apps reliably render.
function toHtml(e: Email) {
  const site = siteUrl();
  const p = (text: string) =>
    `<p style="margin:0 0 16px;font-size:16px;line-height:1.55;color:#c9c9d1;">${escape(text)}</p>`;
  const button = e.button
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px;"><tr>
        <td style="border-radius:999px;background:#7B2FF7;background-image:linear-gradient(90deg,#7B2FF7,#FF3D6E);">
          <a href="${escape(e.button.href)}" style="display:inline-block;padding:14px 28px;font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:999px;">${escape(e.button.label)}</a>
        </td></tr></table>`
    : "";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark">
<title>${escape(e.subject)}</title></head>
<body style="margin:0;padding:0;background:#0B0B0F;">
<div style="display:none;max-height:0;overflow:hidden;">${escape(e.preview)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0B0B0F;">
<tr><td align="center" style="padding:32px 16px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;font-family:Lexend,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <tr><td style="padding:0 0 28px;">
      <a href="${site}" style="font-size:22px;font-weight:700;letter-spacing:-0.02em;color:#F5F5F7;text-decoration:none;">viral<span style="color:#FF3D6E;">owner</span></a>
    </td></tr>
    <tr><td style="background:#15151b;border:1px solid #26262e;border-radius:20px;padding:32px 28px;">
      <h1 style="margin:0 0 16px;font-size:24px;line-height:1.25;font-weight:600;color:#F5F5F7;">${escape(e.heading)}</h1>
      ${e.body.map(p).join("\n      ")}
      ${button}
      ${e.footnote ? `<p style="margin:0;font-size:13px;line-height:1.5;color:#8a8a94;">${escape(e.footnote)}</p>` : ""}
    </td></tr>
    <tr><td style="padding:24px 4px 0;font-size:12px;line-height:1.5;color:#6b6b75;">
      your spin. viral reach. zero editing.<br>
      you’re getting this because you have a viralowner account. questions? email hello@viralowner.com.
    </td></tr>
  </table>
</td></tr></table>
</body></html>`;
}
