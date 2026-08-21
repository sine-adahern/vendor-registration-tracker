import assert from "node:assert/strict";
import { isAdminUser, bearerToken, requireAdmin } from "./admin-guard.mjs";

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log("  ✓ " + name); };
const asyncTest = async (name, fn) => { await fn(); passed++; console.log("  ✓ " + name); };

console.log("isAdminUser:");

test("true when app_metadata.role === 'admin'", () => {
  assert.equal(isAdminUser({ app_metadata: { role: "admin" } }), true);
});
test("true when app_metadata.is_admin === true", () => {
  assert.equal(isAdminUser({ app_metadata: { is_admin: true } }), true);
});
test("false for a normal user", () => {
  assert.equal(isAdminUser({ app_metadata: { role: "user" } }), false);
});
test("false when the flag is only in user_metadata (user-editable)", () => {
  // Critical: users can edit user_metadata, so it must NOT grant admin.
  assert.equal(isAdminUser({ user_metadata: { role: "admin" }, app_metadata: {} }), false);
});
test("false when app_metadata missing", () => {
  assert.equal(isAdminUser({}), false);
});

console.log("bearerToken:");

test("extracts the token after 'Bearer '", () => {
  assert.equal(bearerToken("Bearer abc.def.ghi"), "abc.def.ghi");
});
test("returns '' when header absent", () => {
  assert.equal(bearerToken(undefined), "");
});
test("returns '' for a non-Bearer scheme", () => {
  assert.equal(bearerToken("Basic abc"), "");
});

console.log("requireAdmin:");

// Fake supabase admin client whose getUser returns a preset result.
const fakeClient = (result) => ({ auth: { getUser: async () => result } });

await asyncTest("401 when no token is supplied", async () => {
  await assert.rejects(
    () => requireAdmin("", fakeClient({ data: null, error: null })),
    (e) => e.status === 401,
  );
});

await asyncTest("401 when the token is invalid", async () => {
  await assert.rejects(
    () => requireAdmin("bad", fakeClient({ data: null, error: { message: "bad jwt" } })),
    (e) => e.status === 401,
  );
});

await asyncTest("403 when the caller is authenticated but not an admin", async () => {
  await assert.rejects(
    () => requireAdmin(
      "ok",
      fakeClient({ data: { user: { id: "1", app_metadata: { role: "user" } } }, error: null }),
    ),
    (e) => e.status === 403,
  );
});

await asyncTest("returns the user when authenticated AND admin", async () => {
  const user = { id: "1", email: "a@b.co", app_metadata: { role: "admin" } };
  const got = await requireAdmin(
    "ok",
    fakeClient({ data: { user }, error: null }),
  );
  assert.equal(got.id, "1");
});

console.log(`\n${passed} passed`);
