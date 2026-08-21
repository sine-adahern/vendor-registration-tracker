/* ------------------------------------------------------------------ *
 *  admin-users — user administration endpoint (admin only)            *
 *                                                                     *
 *  One function, routed by HTTP method:                               *
 *    GET    → list existing login accounts                            *
 *    POST   → create a new login account                              *
 *    DELETE → remove a login account                                  *
 *                                                                     *
 *  Every request is gated by requireAdmin() (see lib/admin-guard),    *
 *  which validates the caller's token and checks their admin flag on  *
 *  the SERVER. The browser is never trusted to assert admin status.   *
 *                                                                     *
 *  Uses the SERVICE-ROLE key (server-side only — NEVER exposed to the *
 *  browser and NEVER prefixed with VITE_). Set it in Netlify under    *
 *  Site configuration → Environment variables as:                     *
 *      SUPABASE_SERVICE_ROLE_KEY                                       *
 *  See the README "User administration" section for setup.            *
 * ------------------------------------------------------------------ */
import { createClient } from "@supabase/supabase-js";
import { requireAdmin, isAdminUser } from "./lib/admin-guard.mjs";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY; // secret — server only

// A minimally-permissive password policy. Supabase enforces its own
// minimum too; this is an extra floor. Tune to your org's policy.
const MIN_PASSWORD_LENGTH = 12;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Build a service-role client. Server-side only. */
function adminClient() {
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
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

async function readJson(req) {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

export default async (req) => {
  // 0. Server must be configured with the service-role key.
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return json(
      { error: "User administration isn't configured on the server yet." },
      500,
    );
  }

  const admin = adminClient();

  // 1. Authenticate + authorise the caller (admin only).
  let caller;
  try {
    caller = await requireAdmin(req, admin);
  } catch (e) {
    return json({ error: e.message || "Unauthorized." }, e.status || 401);
  }

  // 2. Route by method.
  try {
    // -------------------------------------------------- LIST
    if (req.method === "GET") {
      const { data, error } = await admin.auth.admin.listUsers({
        page: 1,
        perPage: 200,
      });
      if (error) throw error;
      const users = (data.users || [])
        .map(publicUser)
        .sort((a, b) => (a.email || "").localeCompare(b.email || ""));
      return json({ users });
    }

    // -------------------------------------------------- CREATE
    if (req.method === "POST") {
      const body = await readJson(req);
      if (!body) return json({ error: "Invalid request body." }, 400);

      const email = String(body.email || "").trim().toLowerCase();
      const password = String(body.password || "");
      const makeAdmin = body.makeAdmin === true;

      if (!EMAIL_RE.test(email)) {
        return json({ error: "Enter a valid email address." }, 400);
      }
      if (password.length < MIN_PASSWORD_LENGTH) {
        return json(
          { error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` },
          400,
        );
      }

      const { data, error } = await admin.auth.admin.createUser({
        email,
        password,
        // Account is usable immediately (no confirmation email needed).
        // Set to false if you'd rather require email verification first.
        email_confirm: true,
        // Role lives in app_metadata so the user can't change it themselves.
        app_metadata: { role: makeAdmin ? "admin" : "user" },
      });

      if (error) {
        // e.g. duplicate email, weak password per Supabase policy, etc.
        console.error("createUser failed:", error.message);
        return json({ error: error.message || "Could not create the account." }, 400);
      }

      return json({ user: publicUser(data.user) }, 201);
    }

    // -------------------------------------------------- DELETE
    if (req.method === "DELETE") {
      const body = await readJson(req);
      if (!body) return json({ error: "Invalid request body." }, 400);

      const id = String(body.id || "");
      if (!id) return json({ error: "Missing user id." }, 400);
      // Guard against locking yourself out.
      if (id === caller.id) {
        return json({ error: "You can't delete your own account." }, 400);
      }

      const { error } = await admin.auth.admin.deleteUser(id);
      if (error) {
        console.error("deleteUser failed:", error.message);
        return json({ error: error.message || "Could not delete the account." }, 400);
      }
      return json({ ok: true });
    }

    return json({ error: "Method not allowed." }, 405);
  } catch (e) {
    // Detailed reason stays in the server logs; client gets a generic message.
    console.error("admin-users error:", e && (e.message || e));
    return json({ error: "Unexpected server error." }, 500);
  }
};
