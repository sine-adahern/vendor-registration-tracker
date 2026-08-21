/* ------------------------------------------------------------------ *
 *  /api/admin-users — user administration endpoint (admin only)       *
 *                                                                     *
 *  Vercel serverless function. Reached in the browser at:             *
 *      /api/admin-users                                                *
 *                                                                     *
 *  One function, routed by HTTP method:                               *
 *    GET    → list existing login accounts                            *
 *    POST   → create a new login account                              *
 *    DELETE → remove a login account                                  *
 *                                                                     *
 *  Every request is gated by requireAdmin() (see ../lib/admin-guard), *
 *  which validates the caller's token and checks their admin flag on  *
 *  the SERVER. The browser is never trusted to assert admin status.   *
 *                                                                     *
 *  Uses the SERVICE-ROLE key (server-side only — NEVER exposed to the *
 *  browser and NEVER prefixed with VITE_). In the Vercel dashboard,   *
 *  Project → Settings → Environment Variables, add:                   *
 *      SUPABASE_SERVICE_ROLE_KEY                                       *
 *  then redeploy. See the README "User administration" section.       *
 * ------------------------------------------------------------------ */
import { createClient } from "@supabase/supabase-js";
import { requireAdmin, isAdminUser, bearerToken } from "../lib/admin-guard.mjs";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY; // secret — server only

const MIN_PASSWORD_LENGTH = 12;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Build a service-role client. Server-side only. */
function adminClient() {
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/** Trim a Supabase user down to the fields the admin UI needs. */
function publicUser(u) {
  return {
    id: u.id,
    email: u.email,
    created_at: u.created_at,
    last_sign_in_at: u.last_sign_in_at || null,
    confirmed: Boolean(u.email_confirmed_at || u.confirmed_at),
    is_admin: isAdminUser(u),
  };
}

/** Vercel auto-parses JSON bodies, but be defensive if it arrives as a string. */
function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body); } catch { return null; }
  }
  return req.body;
}

export default async function handler(req, res) {
  // 0. Server must be configured with the service-role key.
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return res
      .status(500)
      .json({ error: "User administration isn't configured on the server yet." });
  }

  const admin = adminClient();

  // 1. Authenticate + authorise the caller (admin only).
  let caller;
  try {
    caller = await requireAdmin(bearerToken(req.headers.authorization), admin);
  } catch (e) {
    return res.status(e.status || 401).json({ error: e.message || "Unauthorized." });
  }

  // 2. Route by method.
  try {
    // -------------------------------------------------- LIST
    if (req.method === "GET") {
      const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
      if (error) throw error;
      const users = (data.users || [])
        .map(publicUser)
        .sort((a, b) => (a.email || "").localeCompare(b.email || ""));
      return res.status(200).json({ users });
    }

    // -------------------------------------------------- CREATE
    if (req.method === "POST") {
      const body = parseBody(req);
      if (!body) return res.status(400).json({ error: "Invalid request body." });

      const email = String(body.email || "").trim().toLowerCase();
      const password = String(body.password || "");
      const makeAdmin = body.makeAdmin === true;

      if (!EMAIL_RE.test(email)) {
        return res.status(400).json({ error: "Enter a valid email address." });
      }
      if (password.length < MIN_PASSWORD_LENGTH) {
        return res
          .status(400)
          .json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` });
      }

      const { data, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true, // usable immediately; set false to require verification
        app_metadata: { role: makeAdmin ? "admin" : "user" },
      });

      if (error) {
        console.error("createUser failed:", error.message);
        return res.status(400).json({ error: error.message || "Could not create the account." });
      }
      return res.status(201).json({ user: publicUser(data.user) });
    }

    // -------------------------------------------------- DELETE
    if (req.method === "DELETE") {
      const body = parseBody(req);
      if (!body) return res.status(400).json({ error: "Invalid request body." });

      const id = String(body.id || "");
      if (!id) return res.status(400).json({ error: "Missing user id." });
      if (id === caller.id) {
        return res.status(400).json({ error: "You can't delete your own account." });
      }

      const { error } = await admin.auth.admin.deleteUser(id);
      if (error) {
        console.error("deleteUser failed:", error.message);
        return res.status(400).json({ error: error.message || "Could not delete the account." });
      }
      return res.status(200).json({ ok: true });
    }

    res.setHeader("Allow", "GET, POST, DELETE");
    return res.status(405).json({ error: "Method not allowed." });
  } catch (e) {
    // Detailed reason stays in the server logs; client gets a generic message.
    console.error("admin-users error:", e && (e.message || e));
    return res.status(500).json({ error: "Unexpected server error." });
  }
}
