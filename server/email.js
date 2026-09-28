const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const TEMPLATE_ID = process.env.RESEND_OTP_TEMPLATE_ID || "1c3330e0-5652-4382-b9ce-42aa577afc7d";
// If set, overrides the sender configured on the template (e.g. before your domain is verified).
const EMAIL_FROM_OVERRIDE = process.env.EMAIL_FROM || "";
const TEMPLATE_CACHE_TTL_MS = 15 * 60 * 1000;

let templateCache = null;
let templateFetchedAt = 0;

async function fetchTemplate() {
  if (templateCache && Date.now() - templateFetchedAt < TEMPLATE_CACHE_TTL_MS) return templateCache;
  const res = await fetch(`https://api.resend.com/templates/${TEMPLATE_ID}`, {
    headers: { Authorization: `Bearer ${RESEND_API_KEY}` },
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Template fetch failed (${res.status}): ${detail || res.statusText}`);
  }
  templateCache = await res.json();
  templateFetchedAt = Date.now();
  return templateCache;
}

// Substitute {{{KEY}}} placeholders (triple-brace mustache, matches the Resend editor).
function substitute(str, vars) {
  return (str || "").replace(/\{\{\{\s*(\w+)\s*\}\}\}/g, (_, k) => (vars[k] !== undefined ? String(vars[k]) : ""));
}

/** Send a 6-digit login/registration code. In dev without a key we log to console. */
export async function sendOtp(to, code, purpose, expiryMinutes = 10) {
  if (!RESEND_API_KEY) {
    console.log(`[email:dev] ${purpose} code for ${to}: ${code}`);
    return { ok: true, dev: true };
  }
  const template = await fetchTemplate();
  const vars = { OTP_CODE: code, EXPIRY_MINUTES: expiryMinutes };
  const payload = {
    from: EMAIL_FROM_OVERRIDE || template.from,
    to,
    subject: substitute(template.subject, vars),
    html: substitute(template.html, vars),
    text: substitute(template.text, vars),
  };

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Email send failed (${res.status}): ${detail || res.statusText}`);
  }
  return { ok: true };
}
