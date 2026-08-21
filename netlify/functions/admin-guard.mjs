/* ------------------------------------------------------------------ *
 *  admin-guard — shared authentication + authorisation for the        *
 *  user-administration endpoint.                                      *
 *                                                                     *
 *  Security model                                                     *
 *  --------------                                                     *
 *  Creating/listing/deleting login accounts is a privileged action.   *
 *  It can ONLY be done with the Supabase service-role key, which is   *
 *  server-side only (never shipped to the browser). Every request to  *
 *  the admin endpoint must prove two things, checked here:            *
 *                                                                     *
 *    1. Authentication — the caller sends their own Supabase access   *
 *       token (JWT). We validate it against Supabase; a forged or     *
 *       expired token is rejected.                                    *
 *    2. Authorisation  — the validated user must carry an admin flag  *
 *       in `app_metadata`. `app_metadata` can only be written by the  *
 *       service role, so a normal user cannot promote themselves.     *
 *       (This is deliberately NOT `user_metadata`, which users CAN    *
 *       edit.)                                                        *
 *                                                                     *
 *  Never trust an "I am an admin" flag sent from the browser — we     *
 *  re-derive admin status from the token on the server every time.    *
 * ------------------------------------------------------------------ */

/** True when a Supabase user object carries admin privileges. */
export function isAdminUser(user) {
  const meta = (user && user.app_metadata) || {};
  return meta.role === "admin" || meta.is_admin === true;
}

/**
 * Pull the Bearer token out of the Authorization header.
 * Returns "" when absent/malformed.
 */
export function bearerToken(req) {
  const header = req.headers.get("authorization") || "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}

/**
 * Verify the caller and require admin.
 *
 * @param {Request} req            incoming request
 * @param {object}  adminClient    a supabase-js client created with the
 *                                 service-role key
 * @returns {Promise<object>}      the validated, admin Supabase user
 * @throws  {{status:number, message:string}} on any failure
 */
export async function requireAdmin(req, adminClient) {
  const token = bearerToken(req);
  if (!token) throw { status: 401, message: "Not signed in." };

  // Validate the token with Supabase (this actually checks the signature
  // and expiry server-side — we are not just decoding it locally).
  const { data, error } = await adminClient.auth.getUser(token);
  if (error || !data || !data.user) {
    throw { status: 401, message: "Your session is invalid or has expired." };
  }

  if (!isAdminUser(data.user)) {
    throw { status: 403, message: "Admin privileges are required." };
  }

  return data.user;
}
