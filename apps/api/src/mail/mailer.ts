import { config } from "../config.js";

export type Mail = { to: string; subject: string; text: string; html: string };
export type MailResult = { sent: boolean; reason?: "not-configured" | "provider-error" };
export type MailTransport = (mail: Mail) => Promise<MailResult>;

/**
 * Resend over its HTTP API, with the same variables as our other projects:
 * RESEND_API_KEY and RESEND_FROM_EMAIL. Without a key nothing is sent and the
 * caller is told so; no request path depends on e-mail being delivered.
 */
const resend: MailTransport = async mail => {
  if (!config.resendApiKey) return { sent: false, reason: "not-configured" };
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${config.resendApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: config.resendFromEmail, to: mail.to, subject: mail.subject, text: mail.text, html: mail.html }),
      signal: AbortSignal.timeout(10_000),
    });
    // The provider's body may echo the recipient; log the status only.
    if (!response.ok) { console.error(`[mail] provider answered ${response.status}`); return { sent: false, reason: "provider-error" }; }
    return { sent: true };
  } catch {
    console.error("[mail] provider request failed");
    return { sent: false, reason: "provider-error" };
  }
};

let transport: MailTransport = resend;
/** Tests replace the transport to capture messages; `null` restores Resend. */
export function setMailTransport(next: MailTransport | null): void { transport = next ?? resend; }
export const mailConfigured = (): boolean => Boolean(config.resendApiKey) || transport !== resend;
export const sendMail = (mail: Mail): Promise<MailResult> => transport(mail);

export const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);

/** One plain layout for every transactional message. */
export function actionMail(to: string, subject: string, lines: string[], action: { label: string; url: string }, footer: string): Mail {
  const text = [...lines, "", `${action.label}: ${action.url}`, "", footer].join("\n");
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#0f172a;max-width:520px">
${lines.map(line => `<p>${escapeHtml(line)}</p>`).join("\n")}
<p><a href="${escapeHtml(action.url)}" style="display:inline-block;background:#059669;color:#ffffff;padding:10px 18px;border-radius:8px;text-decoration:none">${escapeHtml(action.label)}</a></p>
<p style="font-size:12px;color:#64748b">${escapeHtml(footer)}</p>
</div>`;
  return { to, subject, text, html };
}
