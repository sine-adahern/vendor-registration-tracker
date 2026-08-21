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
 *  This module is platform-agnostic: it takes the token as a string,  *
 *  so the same code works on Vercel, Netlify, or anywhere else.       *
 * ------------------------------------------------------------------ */

/** True when a Supabase user object carries admin privileges. */
export function isAdminUser(user) {
  const meta = (user && user.app_metadata) || {};
  return meta.role === "admin" || meta.is_admin === true;
}

/**
 * Pull the Bearer token out of an Authorization header value.
 * @param {string} authHeader  e.g. "Bearer eyJ..." (or undefined)
 * @returns {string} the token, or "" when absent/malformed
 */
export function bearerToken(authHeader) {
  const header = authHeader || "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}

/**
 * Verify the caller and require admin.
 *
 * @param {string} token         the caller's Supabase access token (JWT)
 * @param {object} adminClient   a supabase-js client made with the service-role key
 * @returns {Promise<object>}    the validated, admin Supabase user
 * @throws  {{status:number, message:string}} on any failure
 */
export async function requireAdmin(token, adminClient) {
  if (!token) throw { status: 401, message: "Not signed in." };

  // Validate the token with Supabase (checks signature + expiry server-side —
  // we are not just decoding it locally).
  const { data, error } = await adminClient.auth.getUser(token);
  if (error || !data || !data.user) {
    throw { status: 401, message: "Your session is invalid or has expired." };
  }

  if (!isAdminUser(data.user)) {
    throw { status: 403, message: "Admin privileges are required." };
  }

  return data.user;
}
