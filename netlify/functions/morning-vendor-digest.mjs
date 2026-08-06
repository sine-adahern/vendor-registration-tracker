/* ------------------------------------------------------------------ *
 *  Morning vendor digest — Netlify Scheduled Function                 *
 *                                                                     *
 *  Runs hourly and, at 09:00 Europe/London, emails Sinead and Zain a  *
 *  summary of the vendors on the "Vendors" tab that still need work:  *
 *  which tasks remain, which contact info is missing, and when each   *
 *  was last updated. alokhande@seuk-cl.com is never emailed.          *
 *                                                                     *
 *  Data is read from Supabase with the SERVICE ROLE key (server-side  *
 *  only — never exposed to the browser). Email is sent via Resend.    *
 *  See the "Morning vendor digest" section of the README for setup.   *
 * ------------------------------------------------------------------ */
import {
  resolveRecipients, buildVendorDigest, renderEmail, isSendTime,
} from "./lib/digest.mjs";

/* -------- config (env-overridable) -------- */
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY; // secret — NOT the anon key, NOT VITE_-prefixed
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM = process.env.DIGEST_FROM || "Vendorline <onboarding@yourdomain.com>";
const APP_URL = process.env.DIGEST_APP_URL || process.env.URL || "";
const TZ = process.env.DIGEST_TIMEZONE || "Europe/London";
const HOUR = parseInt(process.env.DIGEST_HOUR || "9", 10);
const SEND_WHEN_EMPTY = process.env.DIGEST_SEND_WHEN_EMPTY !== "false"; // default: send an "all clear"
const TRIGGER_SECRET = process.env.DIGEST_TRIGGER_SECRET || "";

// --- recipient rules ---
// Hard block: these addresses are never emailed, whatever the table says.
const DENYLIST = ["alokhande@seuk-cl.com"];
// Only email people matching these names (checked against the user_name row's
// name column and the email's local part). If Sinead/Zain aren't caught by
// name — e.g. their addresses don't contain "sinead"/"zain" — put their exact
// emails in the DIGEST_ALLOW_EMAILS env var (comma-separated) instead.
const ALLOW_NAMES = ["sinead", "zain"];
const ALLOW_EMAILS = (process.env.DIGEST_ALLOW_EMAILS || "").split(",").map((s) => s.trim()).filter(Boolean);

/* -------- Supabase REST helpers (service role) -------- */
async function sbGet(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  if (!res.ok) throw new Error(`Supabase GET ${path} → ${res.status} ${await res.text()}`);
  return res.json();
}

async function sendEmail({ to, subject, html, text }) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to: [to], subject, html, text }),
  });
  if (!res.ok) throw new Error(`Resend → ${res.status} ${await res.text()}`);
  return res.json();
}

/* -------- handler -------- */
export default async (req) => {
  const now = new Date();

  // Allow a manual, authenticated trigger (?force=SECRET) for testing;
  // otherwise only run during the 9 o'clock hour in London. Scheduled
  // invocations may not carry a normal URL, so parse defensively.
  let forceParam = null;
  try { forceParam = new URL(req.url).searchParams.get("force"); } catch { /* scheduled run */ }
  const forced = TRIGGER_SECRET && forceParam === TRIGGER_SECRET;
  if (!forced && !isSendTime(now, TZ, HOUR)) {
    return json({ skipped: `not ${HOUR}:00 in ${TZ}` });
  }

  for (const [k, v] of Object.entries({ SUPABASE_URL, SERVICE_KEY, RESEND_API_KEY })) {
    if (!v) return json({ error: `Missing required env var: ${k}` }, 500);
  }

  // 1. Pull vendors + their tasks. `select=*` avoids depending on columns
  //    that may not exist (e.g. registration_type); the digest treats a
  //    missing registration_type as "standard".
  let vendors;
  try {
    vendors = await sbGet("vendors?select=*,tasks(status,last_attempted,name,task_index)");
  } catch (e) {
    return json({ error: String(e.message || e) }, 502);
  }

  // 2. Work out who to email (Sinead & Zain; never alokhande).
  let recipients;
  try {
    const users = await sbGet("user_name?select=*");
    recipients = resolveRecipients(users, {
      denylist: DENYLIST, allowNames: ALLOW_NAMES, allowEmails: ALLOW_EMAILS,
    });
  } catch (e) {
    return json({ error: `Could not read user_name: ${String(e.message || e)}` }, 502);
  }
  if (recipients.length === 0) return json({ sent: 0, note: "no eligible recipients" });

  // 3. Build the digest (Vendors tab only, incomplete, stalest first).
  const digest = buildVendorDigest(vendors, { excludeTypes: ["sei"] });
  if (digest.length === 0 && !SEND_WHEN_EMPTY) {
    return json({ sent: 0, note: "nothing outstanding; empty email suppressed" });
  }

  // 4. Send one personalised email each.
  const results = [];
  for (const r of recipients) {
    const { subject, html, text } = renderEmail({ recipient: r, digest, now, tz: TZ, appUrl: APP_URL });
    try {
      await sendEmail({ to: r.email, subject, html, text });
      results.push({ email: r.email, ok: true });
    } catch (e) {
      results.push({ email: r.email, ok: false, error: String(e.message || e) });
    }
  }

  return json({ ranAt: now.toISOString(), tz: TZ, outstanding: digest.length, results });
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body, null, 2), { status, headers: { "content-type": "application/json" } });
}

// Run hourly; the handler itself only sends at HOUR in TZ (DST-proof).
export const config = { schedule: "0 * * * *" };
