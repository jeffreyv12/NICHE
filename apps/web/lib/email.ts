// Thin Resend wrapper for transactional email.
//
// Optional-safe: if RESEND_API_KEY is not set the send is skipped and a warning
// is logged. This keeps dev/CI working without email credentials.

interface SendEmailOptions {
  to: string;
  subject: string;
  /** Plain-text body. */
  text: string;
  /** Optional HTML body; falls back to text wrapped in <pre>. */
  html?: string;
}

interface SendResult {
  ok: boolean;
  id?: string;
  error?: string;
}

export async function sendEmail(opts: SendEmailOptions): Promise<SendResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM ?? "NicheFinder <noreply@example.com>";

  if (!apiKey) {
    console.warn(`[email] RESEND_API_KEY not set — skipping email to ${opts.to}: ${opts.subject}`);
    return { ok: false, error: "RESEND_API_KEY not configured" };
  }

  const html = opts.html ?? `<pre>${opts.text}</pre>`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to: opts.to, subject: opts.subject, text: opts.text, html }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error(`[email] Resend error ${res.status}: ${body}`);
    return { ok: false, error: `HTTP ${res.status}` };
  }

  const data = (await res.json()) as { id?: string };
  return { ok: true, id: data.id };
}
