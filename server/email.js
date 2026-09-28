const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const EMAIL_FROM = process.env.EMAIL_FROM || "Friends Club <onboarding@resend.dev>";
const SITE_NAME = process.env.SITE_NAME || "Friends Club";

/** Send a 6-digit login/registration code. In dev without a key we log to console. */
export async function sendOtp(to, code, purpose) {
  const subject = purpose === "register" ? `Your ${SITE_NAME} verification code` : `Your ${SITE_NAME} sign-in code`;
  const intro = purpose === "register"
    ? "Use this code to finish creating your Friends Club account."
    : "Use this code to sign in to Friends Club.";
  const text = `${intro}\n\nYour code: ${code}\n\nIt expires in 10 minutes. If you didn't request this, ignore this email.`;
  const html = `<!doctype html><html><body style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#0b0d14;color:#e6e8ef;padding:32px">
    <div style="max-width:440px;margin:0 auto;background:#141824;border:1px solid #232838;border-radius:16px;padding:28px">
      <h1 style="margin:0 0 10px;font-size:20px;color:#c8ff5b">${SITE_NAME}</h1>
      <p style="margin:0 0 18px;line-height:1.55;color:#b7bdcc">${intro}</p>
      <div style="font-size:34px;letter-spacing:.42em;font-weight:700;background:#1c2233;border:1px dashed #2f3752;border-radius:12px;padding:18px;text-align:center;color:#e6e8ef">${code}</div>
      <p style="margin:18px 0 0;font-size:12px;color:#8a92a5;line-height:1.55">The code expires in 10 minutes. If you didn't request this, ignore this email.</p>
    </div>
  </body></html>`;

  if (!RESEND_API_KEY) {
    console.log(`[email:dev] ${purpose} code for ${to}: ${code}`);
    return { ok: true, dev: true };
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: EMAIL_FROM, to, subject, text, html }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Email send failed (${res.status}): ${detail || res.statusText}`);
  }
  return { ok: true };
}
