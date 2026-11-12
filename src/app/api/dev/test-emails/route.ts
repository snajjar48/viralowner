import { timingSafeEqual } from "node:crypto";
import { sendEmail, type Email } from "@/lib/email";
import { planWelcomeEmail, trialWelcomeEmail, videoFailedEmail, videoReadyEmail } from "@/lib/notify";
import { siteUrl } from "@/lib/site-url";

// TEMPORARY: sends one of every email to an owner address so they can see
// them. Callable only with WORKER_TOKEN, and only to UNLIMITED_EMAILS.
export async function POST(request: Request) {
  const token = process.env.WORKER_TOKEN;
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${token ?? ""}`);
  if (!token || given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { to } = (await request.json().catch(() => ({}))) as { to?: string };
  const owners = (process.env.UNLIMITED_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase());
  if (!to || !owners.includes(to.trim().toLowerCase())) {
    return Response.json({ error: "Only owner addresses." }, { status: 403 });
  }

  const who = { email: to.trim(), firstName: "Sam" };
  const id = "00000000-0000-4000-8000-000000000000";
  const site = siteUrl();
  const emails: Email[] = [
    videoReadyEmail(who, id, 1),
    videoReadyEmail(who, id, 2),
    videoFailedEmail(who, id, id, 1, "this took too long. please try again."),
    trialWelcomeEmail(who),
    planWelcomeEmail(who, "basic"),
    planWelcomeEmail(who, "pro"),
    {
      to: who.email,
      subject: "confirm your viralowner email (supabase template preview)",
      preview: "one tap and you’re in.",
      heading: "confirm your email.",
      body: ["thanks for signing up for viralowner. tap the button to confirm this is your email, then you’re in."],
      button: { label: "confirm my email", href: `${site}/login` },
      footnote: "didn’t sign up? you can ignore this email.",
    },
    {
      to: who.email,
      subject: "reset your viralowner password (supabase template preview)",
      preview: "pick a new password.",
      heading: "reset your password.",
      body: [
        "someone (hopefully you) asked to reset the password for your viralowner account. tap the button to pick a new one. the link works once and expires in an hour.",
      ],
      button: { label: "pick a new password", href: `${site}/login` },
      footnote: "didn’t ask for this? ignore this email and your password stays the same.",
    },
  ];

  const results = [];
  for (const e of emails) {
    results.push({ subject: e.subject, sent: await sendEmail({ ...e, subject: `[test] ${e.subject}` }) });
  }
  return Response.json({ results });
}
