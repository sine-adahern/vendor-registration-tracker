/* ------------------------------------------------------------------ *
 *  Morning vendor digest — pure helper functions.                     *
 *                                                                     *
 *  These have NO side effects (no network, no env) so they can be     *
 *  unit-tested directly. The Netlify function in                      *
 *  ../morning-vendor-digest.mjs wires them to Supabase + Resend.      *
 * ------------------------------------------------------------------ */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* ---------------- recipients ---------------- */

// The `user_name` table's exact columns aren't known here, so detect the
// email and display-name fields from whatever columns each row has.
const EMAIL_KEYS = ["email", "user_email", "mail", "email_address", "e_mail"];
const NAME_KEYS = ["name", "user_name", "username", "full_name", "display_name", "first_name"];

function pick(row, keys) {
  for (const k of Object.keys(row || {})) {
    if (keys.includes(k.toLowerCase())) {
      const val = row[k];
      if (val != null && String(val).trim() !== "") return String(val).trim();
    }
  }
  return "";
}

export function normalizeUserRows(rows) {
  return (rows || []).map((r) => ({ email: pick(r, EMAIL_KEYS), name: pick(r, NAME_KEYS), raw: r }));
}

/**
 * Decide who actually gets emailed.
 *  - denylist: never email these addresses (hard block — e.g. alokhande@…).
 *  - allowEmails / allowNames: ONLY email people matching one of these.
 * A name match also checks the email's local part, so "sinead"/"zain" still
 * work if the table has no name column but the address is sinead@… / zain@….
 * If both allowlists are empty, nobody is emailed (fail-safe).
 */
export function resolveRecipients(rows, { denylist = [], allowEmails = [], allowNames = [] } = {}) {
  const deny = new Set(denylist.map((e) => String(e).toLowerCase().trim()));
  const allowE = new Set(allowEmails.map((e) => String(e).toLowerCase().trim()).filter(Boolean));
  const allowN = allowNames.map((n) => String(n).toLowerCase().trim()).filter(Boolean);
  const hasAllow = allowE.size > 0 || allowN.length > 0;

  const seen = new Set();
  const out = [];
  for (const u of normalizeUserRows(rows)) {
    const email = u.email.toLowerCase();
    if (!email || !EMAIL_RE.test(email)) continue; // no valid address
    if (deny.has(email)) continue; // hard block (alokhande@seuk-cl.com)
    if (!hasAllow) continue; // fail-safe: empty allowlist ⇒ email no one

    const local = email.split("@")[0];
    const nameHit = allowN.some((n) => u.name.toLowerCase().includes(n) || local.includes(n));
    const emailHit = allowE.has(email);
    if (!nameHit && !emailHit) continue; // not sinead or zain

    if (seen.has(email)) continue; // dedupe
    seen.add(email);
    out.push({ email: u.email, name: u.name });
  }
  return out;
}

/* ---------------- vendor digest ---------------- */

// The four "info" fields shown on a vendor's detail page.
const INFO_FIELDS = [
  ["requester", "Requester"],
  ["contact_person", "Vendor contact"],
  ["contact_email", "Contact email"],
  ["phone", "Phone number"],
];
const PAGE_LABEL = { standard: "Vendors", sei: "SEI registration" };

const regType = (v) => (v.registration_type === "sei" ? "sei" : "standard");

export function summarizeVendor(v) {
  const tasks = (v.tasks || []).slice().sort((a, b) => (a.task_index ?? 0) - (b.task_index ?? 0));
  const total = tasks.length;
  const done = tasks.filter((t) => t.status === "done").length;
  const remaining = tasks.filter((t) => t.status !== "done").map((t) => t.name);
  const missingInfo = INFO_FIELDS.filter(([k]) => !(v[k] && String(v[k]).trim())).map(([, label]) => label);
  const attempted = tasks.map((t) => t.last_attempted).filter(Boolean).sort();
  const lastUpdated = attempted.length ? attempted[attempted.length - 1] : v.created_at || null;
  return {
    id: v.id,
    name: v.name,
    page: PAGE_LABEL[regType(v)] || "Vendors",
    addedBy: v.added_by || null,
    done,
    total,
    remaining,
    missingInfo,
    lastUpdated,
    complete: total > 0 && done === total,
  };
}

/**
 * Build the list of vendors that still need work.
 *  - excludeTypes: registration types to leave out (default ['sei'] so the
 *    digest only covers the "Vendors" onboarding tab).
 * Sorted stalest-first (oldest last activity at the top).
 */
export function buildVendorDigest(vendors, { excludeTypes = ["sei"] } = {}) {
  const exclude = new Set(excludeTypes);
  return (vendors || [])
    .filter((v) => !exclude.has(regType(v)))
    .map(summarizeVendor)
    .filter((s) => !s.complete)
    .sort((a, b) => new Date(a.lastUpdated || 0) - new Date(b.lastUpdated || 0));
}

/* ---------------- time gating (DST-proof) ---------------- */

// Current hour (0–23) at `date` in the given IANA timezone.
export function hourInTz(date, tz) {
  const h = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "numeric", hour12: false }).format(date);
  return parseInt(h, 10) % 24; // en-GB can return "24" at midnight
}

export function isSendTime(date, tz, targetHour) {
  return hourInTz(date, tz) === targetHour;
}

/* ---------------- formatting ---------------- */

export function fmtDate(iso, now = new Date(), tz = "Europe/London") {
  if (!iso) return "never";
  const d = new Date(iso);
  if (isNaN(d)) return "never";
  const abs = new Intl.DateTimeFormat("en-GB", { timeZone: tz, day: "numeric", month: "short", year: "numeric" }).format(d);
  const days = Math.floor((startOfDay(now, tz) - startOfDay(d, tz)) / 86400000);
  let rel;
  if (days <= 0) rel = "today";
  else if (days === 1) rel = "yesterday";
  else rel = `${days} days ago`;
  return `${abs} · ${rel}`;
}

function startOfDay(date, tz) {
  // Midnight of `date` in `tz`, expressed as a UTC timestamp for day-diffing.
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(date); // "YYYY-MM-DD"
  return new Date(`${parts}T00:00:00Z`).getTime();
}

/* ---------------- email rendering ---------------- */

export function renderEmail({ recipient, digest, now = new Date(), tz = "Europe/London", appUrl = "" }) {
  const name = recipient?.name ? recipient.name.split(/\s+/)[0] : "";
  const greeting = name ? `Good morning, ${escapeHtml(name)}` : "Good morning";
  const n = digest.length;

  if (n === 0) {
    const subject = "Vendor onboarding — all caught up";
    const line = "Nothing outstanding on the Vendors tab this morning — every vendor is complete. 🎉";
    return {
      subject,
      text: `${greeting.replace(/<[^>]+>/g, "")}\n\n${line}\n`,
      html: shell(`<p style="margin:0 0 8px;font-size:16px;">${greeting}</p><p style="margin:0;color:#647089;">${line}</p>`, appUrl),
    };
  }

  const subject = `Vendor onboarding — ${n} still open`;

  const rowsHtml = digest.map((v) => vendorCardHtml(v, now, tz)).join("");
  const html = shell(
    `<p style="margin:0 0 4px;font-size:16px;font-weight:600;">${greeting}</p>
     <p style="margin:0 0 20px;color:#647089;font-size:14px;">
       ${n} vendor${n === 1 ? "" : "s"} on the Vendors tab still need${n === 1 ? "s" : ""} finishing. Oldest first.
     </p>
     ${rowsHtml}`,
    appUrl
  );

  const text = [
    greeting.replace(/<[^>]+>/g, ""),
    "",
    `${n} vendor${n === 1 ? "" : "s"} still need finishing (oldest first):`,
    "",
    ...digest.map((v) => vendorCardText(v, now, tz)),
  ].join("\n");

  return { subject, html, text };
}

function vendorCardText(v, now, tz) {
  const parts = [
    `• ${v.name}  (${v.done}/${v.total} tasks done)`,
    `    Last updated: ${fmtDate(v.lastUpdated, now, tz)}`,
  ];
  if (v.remaining.length) parts.push(`    Tasks left: ${v.remaining.join(", ")}`);
  if (v.missingInfo.length) parts.push(`    Missing info: ${v.missingInfo.join(", ")}`);
  return parts.join("\n") + "\n";
}

function vendorCardHtml(v, now, tz) {
  const chip = (label, tone) =>
    `<span style="display:inline-block;margin:2px 6px 2px 0;padding:3px 8px;border-radius:6px;font-size:12px;background:${tone.bg};color:${tone.fg};">${escapeHtml(label)}</span>`;
  const amber = { bg: "#FBF1DE", fg: "#a9751a" };
  const grey = { bg: "#EEF1F6", fg: "#647089" };

  const remaining = v.remaining.length
    ? `<div style="margin:8px 0 0;"><span style="font-size:12px;color:#647089;">Tasks left:</span><br>${v.remaining.map((t) => chip(t, amber)).join("")}</div>`
    : "";
  const missing = v.missingInfo.length
    ? `<div style="margin:8px 0 0;"><span style="font-size:12px;color:#647089;">Missing info:</span><br>${v.missingInfo.map((t) => chip(t, grey)).join("")}</div>`
    : `<div style="margin:8px 0 0;font-size:12px;color:#2E9E6B;">All contact info filled in.</div>`;

  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #E1E6EF;border-radius:12px;margin:0 0 12px;">
    <tr><td style="padding:16px 18px;">
      <div style="display:flex;justify-content:space-between;">
        <span style="font-size:15px;font-weight:600;color:#141C29;">${escapeHtml(v.name)}</span>
        <span style="font-size:13px;color:#647089;">${v.done}/${v.total} done</span>
      </div>
      <div style="margin:4px 0 0;font-size:12px;color:#647089;">Last updated: ${fmtDate(v.lastUpdated, now, tz)}${v.addedBy ? " · added by " + escapeHtml(v.addedBy) : ""}</div>
      ${remaining}
      ${missing}
    </td></tr>
  </table>`;
}

function shell(inner, appUrl) {
  const cta = appUrl
    ? `<p style="margin:20px 0 0;"><a href="${escapeAttr(appUrl)}" style="color:#000080;font-size:14px;">Open the tracker →</a></p>`
    : "";
  return `<div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#141C29;">
    <div style="font-weight:700;font-size:16px;margin:0 0 16px;">Vendorline · morning digest</div>
    ${inner}
    ${cta}
    <p style="margin:24px 0 0;font-size:11px;color:#AEB6C4;">You're getting this because you're on the Vendorline team digest list.</p>
  </div>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function escapeAttr(s) {
  return escapeHtml(s);
}
