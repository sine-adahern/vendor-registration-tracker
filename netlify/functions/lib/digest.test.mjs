import assert from "node:assert/strict";
import {
  resolveRecipients, buildVendorDigest, summarizeVendor,
  isSendTime, hourInTz, fmtDate, renderEmail,
} from "./digest.mjs";

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log("  ✓ " + name); };

const DENY = ["alokhande@seuk-cl.com"];
const ALLOW_NAMES = ["sinead", "zain"];

console.log("recipients:");

test("excludes alokhande, keeps only sinead & zain (name column)", () => {
  const rows = [
    { name: "Alok Lokhande", email: "alokhande@seuk-cl.com" },
    { name: "Sinead Murphy", email: "sinead@seuk-cl.com" },
    { name: "Zain Ali", email: "zain@seuk-cl.com" },
    { name: "Someone Else", email: "other@seuk-cl.com" },
  ];
  const got = resolveRecipients(rows, { denylist: DENY, allowNames: ALLOW_NAMES }).map((r) => r.email);
  assert.deepEqual(got.sort(), ["sinead@seuk-cl.com", "zain@seuk-cl.com"]);
});

test("alokhande blocked even if a name allowlist would otherwise match", () => {
  const rows = [{ name: "Sinead", email: "alokhande@seuk-cl.com" }]; // name says sinead, addr is alok
  const got = resolveRecipients(rows, { denylist: DENY, allowNames: ALLOW_NAMES });
  assert.equal(got.length, 0);
});

test("matches on email local-part when there is no name column", () => {
  const rows = [
    { user_email: "sinead@seuk-cl.com" },
    { user_email: "zain@seuk-cl.com" },
    { user_email: "alokhande@seuk-cl.com" },
    { user_email: "dave@seuk-cl.com" },
  ];
  const got = resolveRecipients(rows, { denylist: DENY, allowNames: ALLOW_NAMES }).map((r) => r.email);
  assert.deepEqual(got.sort(), ["sinead@seuk-cl.com", "zain@seuk-cl.com"]);
});

test("supports an explicit email allowlist too", () => {
  const rows = [
    { name: "S", email: "s.murphy@seuk-cl.com" },
    { name: "Z", email: "z.ali@seuk-cl.com" },
    { name: "A", email: "alokhande@seuk-cl.com" },
  ];
  const got = resolveRecipients(rows, {
    denylist: DENY, allowEmails: ["s.murphy@seuk-cl.com", "z.ali@seuk-cl.com"],
  }).map((r) => r.email);
  assert.deepEqual(got.sort(), ["s.murphy@seuk-cl.com", "z.ali@seuk-cl.com"]);
});

test("empty allowlist ⇒ nobody emailed (fail-safe)", () => {
  const rows = [{ name: "Sinead", email: "sinead@seuk-cl.com" }];
  assert.equal(resolveRecipients(rows, { denylist: DENY }).length, 0);
});

test("dedupes and ignores rows without a valid email", () => {
  const rows = [
    { name: "Sinead", email: "sinead@seuk-cl.com" },
    { name: "Sinead again", email: "SINEAD@seuk-cl.com" },
    { name: "Zain", email: "not-an-email" },
  ];
  const got = resolveRecipients(rows, { denylist: DENY, allowNames: ALLOW_NAMES });
  assert.equal(got.length, 1);
  assert.equal(got[0].email, "sinead@seuk-cl.com");
});

console.log("vendor digest:");

const mkVendor = (over = {}) => ({
  id: "v", name: "Acme", registration_type: "standard",
  requester: "", contact_person: "", contact_email: "", phone: "",
  created_at: "2025-01-01T00:00:00Z", tasks: [], ...over,
});
const task = (i, status, last = null) => ({ task_index: i, name: `Task ${i}`, status, last_attempted: last });

test("summarize reports remaining tasks, missing info, last updated", () => {
  const v = mkVendor({
    requester: "Priya", contact_email: "x@y.com", // contact_person + phone missing
    tasks: [task(0, "done", "2025-02-01T00:00:00Z"), task(1, "todo"), task(2, "active", "2025-02-03T00:00:00Z")],
  });
  const s = summarizeVendor(v);
  assert.equal(s.done, 1);
  assert.equal(s.total, 3);
  assert.deepEqual(s.remaining, ["Task 1", "Task 2"]);
  assert.deepEqual(s.missingInfo, ["Vendor contact", "Phone number"]);
  assert.equal(s.lastUpdated, "2025-02-03T00:00:00Z");
  assert.equal(s.complete, false);
});

test("completed vendors are dropped; SEI excluded; stalest first", () => {
  const vendors = [
    mkVendor({ id: "done", name: "Done", tasks: [task(0, "done"), task(1, "done")] }),
    mkVendor({ id: "sei", name: "SeiCo", registration_type: "sei", tasks: [task(0, "todo")] }),
    mkVendor({ id: "fresh", name: "Fresh", tasks: [task(0, "todo", "2025-05-01T00:00:00Z")] }),
    mkVendor({ id: "stale", name: "Stale", tasks: [task(0, "todo", "2025-03-01T00:00:00Z")] }),
  ];
  const out = buildVendorDigest(vendors);
  assert.deepEqual(out.map((v) => v.id), ["stale", "fresh"]); // no done, no sei, stalest first
});

console.log("time gating (Europe/London, DST-proof):");

test("09:00 London in winter (GMT) sends; 08:00 does not", () => {
  assert.equal(isSendTime(new Date("2025-01-15T09:00:00Z"), "Europe/London", 9), true);
  assert.equal(isSendTime(new Date("2025-01-15T08:00:00Z"), "Europe/London", 9), false);
});

test("09:00 London in summer (BST = UTC+1) sends at 08:00 UTC, not 09:00 UTC", () => {
  assert.equal(isSendTime(new Date("2025-07-15T08:00:00Z"), "Europe/London", 9), true);
  assert.equal(isSendTime(new Date("2025-07-15T09:00:00Z"), "Europe/London", 9), false);
  assert.equal(hourInTz(new Date("2025-07-15T08:00:00Z"), "Europe/London"), 9);
});

console.log("formatting / rendering:");

test("fmtDate gives absolute + relative", () => {
  const now = new Date("2025-05-10T09:00:00Z");
  assert.match(fmtDate("2025-05-07T09:00:00Z", now), /May 2025 · 3 days ago/);
  assert.match(fmtDate(null, now), /never/);
});

test("renderEmail: empty digest = all-clear; non-empty lists vendors and hides alokhande nowhere", () => {
  const clear = renderEmail({ recipient: { name: "Sinead Murphy" }, digest: [] });
  assert.match(clear.subject, /all caught up/);
  assert.match(clear.html, /Good morning, Sinead/);

  const full = renderEmail({
    recipient: { name: "Zain" },
    digest: buildVendorDigest([mkVendor({ name: "Acme", tasks: [task(0, "todo", "2025-03-01T00:00:00Z")] })]),
    appUrl: "https://tracker.example.com",
  });
  assert.match(full.subject, /1 still open/);
  assert.match(full.html, /Acme/);
  assert.match(full.text, /Missing info: Requester, Vendor contact, Contact email, Phone number/);
  assert.match(full.html, /Open the tracker/);
});

console.log(`\nAll ${passed} tests passed.`);
