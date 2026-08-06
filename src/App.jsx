import React, { useState, useEffect, useMemo, useCallback } from "react";
import { supabase, isConfigured } from "./supabaseClient";

/* ------------------------------------------------------------------ */
/*  Vendor onboarding tracker — Supabase-backed version                */
/*  Data (vendors, tasks, comments, files) is stored in Supabase and   */
/*  shared across everyone who logs in.                                 */
/* ------------------------------------------------------------------ */

const STATUS_OPTIONS = [
  { value: "todo", label: "Not started" },
  { value: "active", label: "In progress" },
  { value: "done", label: "Done" },
];

const VENDOR_SELECT = "*, tasks(*, task_files(*)), comments(*)";

// The two vendor "pages". Each registers vendors of its own registration_type,
// which the Postgres trigger uses to pick the right task checklist.
const PAGES = {
  standard: {
    label: "Vendors",
    title: "Vendors",
    formNote: "Registering creates the 7 standard onboarding tasks for this vendor.",
  },
  sei: {
    label: "SEI registration",
    title: "SEI registration",
    formNote: "Registering creates the 5 SEI onboarding tasks for this vendor.",
  },
};
const PAGE_KEYS = Object.keys(PAGES);
const vendorPage = (v) => (v.registration_type === "sei" ? "sei" : "standard");

// The setting-sheet task also accepts Excel; every other document task stays PDF/Word.
const isSettingSheet = (task) => /setting sheet/i.test(task.name || "");
const acceptFor = (task) => (isSettingSheet(task) ? ".pdf,.docx,.xlsx,.xls" : ".pdf,.docx");

const fmtDate = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  const diff = Math.floor((new Date() - d) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  if (diff < 7) return `${diff}d ago`;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
};

const normalizeVendor = (v) => ({
  ...v,
  tasks: (v.tasks || [])
    .slice()
    .sort((a, b) => a.task_index - b.task_index)
    .map((t) => ({ ...t, task_files: t.task_files || [] })),
  comments: (v.comments || [])
    .slice()
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at)),
});

const progress = (v) => v.tasks.filter((t) => t.status === "done").length;
const taskCount = (v) => v.tasks.length || 7;
const lastActivity = (v) => {
  const dates = v.tasks.map((t) => t.last_attempted).filter(Boolean);
  return dates.length ? dates.sort().slice(-1)[0] : null;
};
const tone = (v) => {
  const done = progress(v);
  if (v.tasks.length && done === v.tasks.length) return "done";
  if (done === 0 && !v.tasks.some((t) => t.status === "active")) return "todo";
  return "active";
};

/* ================================================================== */
/*  Top-level: config gate → auth gate → dashboard                     */
/* ================================================================== */
export default function App() {
  const [session, setSession] = useState(null);
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    if (!isConfigured) {
      setAuthReady(true);
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (!isConfigured) return <ConfigNeeded />;
  if (!authReady) return <Root><main className="vt-main"><p className="vt-loading">Loading…</p></main></Root>;
  if (!session) return <Login />;
  return <Dashboard session={session} />;
}

function Root({ children }) {
  return (
    <div className="vt-root">
      <style>{css}</style>
      {children}
    </div>
  );
}

/* ================================================================== */
/*  CONFIG NEEDED (env vars not set)                                   */
/* ================================================================== */
function ConfigNeeded() {
  return (
    <Root>
      <div className="vt-auth">
        <div className="vt-auth-card">
          <div className="vt-brand vt-brand-center">
            <span className="vt-wordmark">onboarding tracker</span>
          </div>
          <h1 className="vt-auth-title">Almost there</h1>
          <p className="vt-config-text">
            This app needs to be connected to a Supabase project. Add your
            <code> VITE_SUPABASE_URL </code> and <code> VITE_SUPABASE_ANON_KEY </code>
            (locally in a <code>.env</code> file, and in Netlify's environment
            variables), then redeploy. Full steps are in the README.
          </p>
        </div>
      </div>
    </Root>
  );
}

/* ================================================================== */
/*  LOGIN                                                              */
/* ================================================================== */
function Login() {
  const [mode, setMode] = useState("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setErr(""); setInfo(""); setBusy(true);
    const { error } =
      mode === "signin"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    if (mode === "signup")
      setInfo("Account created. If email confirmation is on, check your inbox, then sign in.");
  };

  return (
    <Root>
      <div className="vt-auth">
        <div className="vt-auth-card">
          <div className="vt-brand vt-brand-center">
            <span className="vt-wordmark">onboarding tracker</span>
          </div>
          <h1 className="vt-auth-title">{mode === "signin" ? "Sign in" : "Create account"}</h1>

          <label className="vt-field">
            <span>Email</span>
            <input type="email" value={email} placeholder="you@company.com"
              onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="vt-field vt-field-gap">
            <span>Password</span>
            <input type="password" value={password} placeholder="••••••••"
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()} />
          </label>

          {err && <p className="vt-auth-err">{err}</p>}
          {info && <p className="vt-auth-info">{info}</p>}

          <button className="vt-btn vt-btn-primary vt-btn-block" onClick={submit} disabled={busy}>
            {busy ? "…" : mode === "signin" ? "Sign in" : "Sign up"}
          </button>

          <p className="vt-auth-switch">
            {mode === "signin" ? "No account yet? " : "Already have an account? "}
            <button onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setErr(""); setInfo(""); }}>
              {mode === "signin" ? "Create one" : "Sign in"}
            </button>
          </p>
        </div>
      </div>
    </Root>
  );
}

/* ================================================================== */
/*  DASHBOARD (data layer)                                             */
/* ================================================================== */
function Dashboard({ session }) {
  const me = session.user.email;
  const [vendors, setVendors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [page, setPage] = useState("standard");
  const [selectedId, setSelectedId] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [commentDraft, setCommentDraft] = useState("");

  const switchPage = (p) => {
    setPage(p);
    setSelectedId(null);
    setShowForm(false);
    setDraftName("");
  };

  const loadVendors = useCallback(async () => {
    setLoading(true); setLoadError("");
    const { data, error } = await supabase
      .from("vendors").select(VENDOR_SELECT)
      .order("created_at", { ascending: false });
    if (error) { setLoadError(error.message); setLoading(false); return; }
    setVendors((data || []).map(normalizeVendor));
    setLoading(false);
  }, []);

  useEffect(() => { loadVendors(); }, [loadVendors]);

  const selected = vendors.find((v) => v.id === selectedId) || null;
  const pageVendors = useMemo(() => vendors.filter((v) => vendorPage(v) === page), [vendors, page]);

  const stats = useMemo(() => {
    const total = pageVendors.length;
    const complete = pageVendors.filter((v) => v.tasks.length && progress(v) === v.tasks.length).length;
    return { total, complete, inProgress: total - complete };
  }, [pageVendors]);

  const registerVendor = async () => {
    const name = draftName.trim();
    if (!name) return;
    const { data, error } = await supabase
      .from("vendors").insert({ name, added_by: me, registration_type: page }).select("id").single();
    if (error) { alert("Could not register vendor: " + error.message); return; }
    const { data: full } = await supabase
      .from("vendors").select(VENDOR_SELECT).eq("id", data.id).single();
    if (full) setVendors((prev) => [normalizeVendor(full), ...prev]);
    setDraftName(""); setShowForm(false);
  };

  const setTaskStatus = async (taskId, status, currentLast) => {
    const last = status === "todo" ? currentLast : new Date().toISOString();
    setVendors((prev) =>
      prev.map((v) => ({
        ...v,
        tasks: v.tasks.map((t) => (t.id === taskId ? { ...t, status, last_attempted: last } : t)),
      }))
    );
    const { error } = await supabase.from("tasks").update({ status, last_attempted: last }).eq("id", taskId);
    if (error) { alert("Could not update status: " + error.message); loadVendors(); }
  };

  const updateFieldLocal = (vendorId, field, value) =>
    setVendors((prev) => prev.map((v) => (v.id === vendorId ? { ...v, [field]: value } : v)));

  const persistField = async (vendorId, field, value) => {
    const { error } = await supabase.from("vendors").update({ [field]: value }).eq("id", vendorId);
    if (error) alert("Could not save: " + error.message);
  };

  const addComment = async (vendorId, body) => {
    const text = body.trim();
    if (!text) return;
    const { data, error } = await supabase
      .from("comments").insert({ vendor_id: vendorId, author: me, body: text }).select("*").single();
    if (error) { alert("Could not post comment: " + error.message); return; }
    setVendors((prev) => prev.map((v) => (v.id === vendorId ? { ...v, comments: [...v.comments, data] } : v)));
    setCommentDraft("");
  };

  const addFiles = async (vendorId, taskId, fileList) => {
    const files = Array.from(fileList);
    const added = [];
    for (const file of files) {
      const path = `${vendorId}/${taskId}/${crypto.randomUUID()}-${file.name}`;
      const { error: upErr } = await supabase.storage.from("vendor-files").upload(path, file);
      if (upErr) { alert(`Upload failed for ${file.name}: ${upErr.message}`); continue; }
      const { data: row, error: rowErr } = await supabase
        .from("task_files").insert({ task_id: taskId, name: file.name, path }).select("*").single();
      if (rowErr) { alert("Could not save file record: " + rowErr.message); continue; }
      added.push(row);
    }
    if (added.length)
      setVendors((prev) =>
        prev.map((v) =>
          v.id === vendorId
            ? { ...v, tasks: v.tasks.map((t) => (t.id === taskId ? { ...t, task_files: [...t.task_files, ...added] } : t)) }
            : v
        )
      );
  };

  const removeFile = async (vendorId, taskId, fileId, path) => {
    setVendors((prev) =>
      prev.map((v) =>
        v.id === vendorId
          ? { ...v, tasks: v.tasks.map((t) => (t.id === taskId ? { ...t, task_files: t.task_files.filter((f) => f.id !== fileId) } : t)) }
          : v
      )
    );
    await supabase.storage.from("vendor-files").remove([path]);
    await supabase.from("task_files").delete().eq("id", fileId);
  };

  const openFile = async (path) => {
    const { data, error } = await supabase.storage.from("vendor-files").createSignedUrl(path, 3600);
    if (error) { alert("Could not open file: " + error.message); return; }
    if (data?.signedUrl) window.open(data.signedUrl, "_blank");
  };

  const deleteVendor = async (vendorId) => {
    const target = vendors.find((v) => v.id === vendorId);
    if (!target) return;
    const ok = window.confirm(
      `Delete "${target.name}"? This permanently removes its tasks, comments, and uploaded files. This cannot be undone.`
    );
    if (!ok) return;

    // Row cascades handle tasks/comments/task_files rows, but NOT the objects in
    // Storage — collect their paths from local state and remove them explicitly.
    const paths = target.tasks
      .flatMap((t) => (t.task_files || []).map((f) => f.path))
      .filter(Boolean);

    // Optimistic: drop from local state and leave the detail view if it's open.
    setVendors((prev) => prev.filter((v) => v.id !== vendorId));
    if (selectedId === vendorId) setSelectedId(null);

    if (paths.length) {
      const { error: storageErr } = await supabase.storage.from("vendor-files").remove(paths);
      if (storageErr) console.warn("Some vendor files may not have been removed:", storageErr.message);
    }

    const { error } = await supabase.from("vendors").delete().eq("id", vendorId);
    if (error) {
      alert("Could not delete vendor: " + error.message);
      loadVendors(); // re-sync local state with the database
    }
  };

  return (
    <Root>
      <header className="vt-topbar">
        <div className="vt-brand">
          <span className="vt-wordmark">onboarding tracker</span>
        </div>
        <div className="vt-me">
          <span className="vt-me-email">{me}</span>
          <button className="vt-signout" onClick={() => supabase.auth.signOut()}>Sign out</button>
        </div>
      </header>

      <main className="vt-main">
        {loading ? (
          <p className="vt-loading">Loading…</p>
        ) : loadError ? (
          <p className="vt-loading">Couldn't load data: {loadError}</p>
        ) : !selected ? (
          <>
            <PageNav page={page} onSwitch={switchPage} />
            <ListView
              vendors={pageVendors} stats={stats} me={me}
              title={PAGES[page].title} formNote={PAGES[page].formNote}
              onOpen={setSelectedId}
              showForm={showForm} setShowForm={setShowForm}
              draftName={draftName} setDraftName={setDraftName}
              onRegister={registerVendor}
            />
          </>
        ) : (
          <DetailView
            vendor={selected}
            onBack={() => setSelectedId(null)}
            onDelete={deleteVendor}
            onUpdateFieldLocal={updateFieldLocal}
            onPersistField={persistField}
            onSetStatus={setTaskStatus}
            onAddFiles={addFiles} onRemoveFile={removeFile} onOpenFile={openFile}
            commentDraft={commentDraft} setCommentDraft={setCommentDraft}
            onAddComment={addComment}
          />
        )}
      </main>
    </Root>
  );
}

/* ================================================================== */
/*  PAGE NAV (switch between vendor sets)                              */
/* ================================================================== */
function PageNav({ page, onSwitch }) {
  return (
    <nav className="vt-tabs" aria-label="Vendor sets">
      {PAGE_KEYS.map((key) => (
        <button
          key={key}
          className={`vt-tab ${page === key ? "vt-tab-on" : ""}`}
          aria-current={page === key ? "page" : undefined}
          onClick={() => onSwitch(key)}
        >
          {PAGES[key].label}
        </button>
      ))}
    </nav>
  );
}

/* ================================================================== */
/*  LIST VIEW                                                          */
/* ================================================================== */
function ListView({ vendors, stats, me, title, formNote, onOpen, showForm, setShowForm, draftName, setDraftName, onRegister }) {
  return (
    <>
      <div className="vt-head-row">
        <div>
          <h1 className="vt-h1">{title}</h1>
        </div>
        <button className="vt-btn vt-btn-primary" onClick={() => setShowForm((s) => !s)}>
          {showForm ? "Cancel" : "+ Register vendor"}
        </button>
      </div>

      <div className="vt-stats">
        <Stat n={stats.total} label="Total vendors" tone="ink" />
        <Stat n={stats.inProgress} label="In progress" tone="active" />
        <Stat n={stats.complete} label="Complete" tone="done" />
      </div>

      {showForm && (
        <div className="vt-form-card">
          <div className="vt-form-fields">
            <label className="vt-field">
              <span>Vendor name</span>
              <input autoFocus placeholder="e.g. Farnell" value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && onRegister()} />
            </label>
            <div className="vt-field vt-field-owner">
              <span>Added by</span>
              <div className="vt-owner-chip">{me}</div>
            </div>
          </div>
          <p className="vt-form-note">{formNote}</p>
          <button className="vt-btn vt-btn-primary" onClick={onRegister}>Register &amp; create tasks</button>
        </div>
      )}

      <div className="vt-list">
        <div className="vt-list-head">
          <span>Vendor</span><span>Added by</span><span>Progress</span><span>Last activity</span>
        </div>
        {vendors.length === 0 && <p className="vt-empty vt-list-empty">No vendors yet. Register your first one above.</p>}
        {vendors.map((v) => {
          const t = tone(v);
          const done = progress(v);
          const total = taskCount(v);
          return (
            <button key={v.id} className="vt-row" onClick={() => onOpen(v.id)}>
              <span className={`vt-spine vt-tone-${t}`} aria-hidden />
              <span className="vt-cell-vendor"><span className="vt-vendor-name">{v.name}</span></span>
              <span className="vt-cell-owner">{v.added_by || "—"}</span>
              <span className="vt-cell-progress">
                <span className="vt-bar">
                  <span className={`vt-bar-fill vt-tone-${t}`} style={{ width: `${(done / total) * 100}%` }} />
                </span>
                <span className="vt-bar-num">{done}/{total}</span>
              </span>
              <span className="vt-cell-date">{fmtDate(lastActivity(v))}</span>
              <span className="vt-chev" aria-hidden>›</span>
            </button>
          );
        })}
      </div>
    </>
  );
}

function Stat({ n, label, tone }) {
  return (
    <div className="vt-stat">
      <span className={`vt-stat-n vt-tone-text-${tone}`}>{n}</span>
      <span className="vt-stat-label">{label}</span>
    </div>
  );
}

/* ================================================================== */
/*  DETAIL VIEW                                                        */
/* ================================================================== */
function DetailView({ vendor, onBack, onDelete, onUpdateFieldLocal, onPersistField, onSetStatus, onAddFiles, onRemoveFile, onOpenFile, commentDraft, setCommentDraft, onAddComment }) {
  const done = progress(vendor);
  const total = taskCount(vendor);
  const t = tone(vendor);

  const infoFields = [
    { key: "requester", label: "Requester", type: "text", placeholder: "Who requested this vendor" },
    { key: "contact_person", label: "Vendor contact", type: "text", placeholder: "Contact person" },
    { key: "contact_email", label: "Contact email", type: "email", placeholder: "name@vendor.com" },
    { key: "phone", label: "Phone number", type: "tel", placeholder: "+44 …" },
  ];

  return (
    <>
      <div className="vt-detail-topbar">
        <button className="vt-back" onClick={onBack}>‹ All vendors</button>
        <button className="vt-btn vt-btn-danger" onClick={() => onDelete(vendor.id)}>Delete vendor</button>
      </div>

      <div className="vt-detail-head">
        <div>
          <h1 className="vt-h1">{vendor.name}</h1>
          <p className="vt-sub">Added by {vendor.added_by || "—"} · {fmtDate(vendor.created_at)}</p>
        </div>
        <div className="vt-detail-progress">
          <span className={`vt-detail-num vt-tone-text-${t}`}>{done}/{total}</span>
          <span className="vt-detail-num-label">tasks done</span>
        </div>
      </div>

      <div className="vt-info">
        {infoFields.map((f) => (
          <label key={f.key} className="vt-info-field">
            <span className="vt-info-label">{f.label}</span>
            <input
              type={f.type}
              value={vendor[f.key] || ""}
              placeholder={f.placeholder}
              onChange={(e) => onUpdateFieldLocal(vendor.id, f.key, e.target.value)}
              onBlur={(e) => onPersistField(vendor.id, f.key, e.target.value)}
            />
          </label>
        ))}
      </div>

      <div className="vt-columns">
        <section className="vt-panel">
          <h2 className="vt-h2">Onboarding tasks</h2>
          <p className="vt-panel-hint">Tasks can be completed in any order.</p>
          <ol className="vt-tasks">
            {vendor.tasks.map((task, i) => (
              <li key={task.id} className="vt-task">
                <div className="vt-task-main">
                  <span className="vt-task-idx">{String(i + 1).padStart(2, "0")}</span>
                  <span className="vt-task-name">{task.name}</span>
                  <span className="vt-task-date">{fmtDate(task.last_attempted)}</span>
                  <select
                    className={`vt-select vt-select-${task.status}`}
                    value={task.status}
                    onChange={(e) => onSetStatus(task.id, e.target.value, task.last_attempted)}
                    aria-label={`Status for ${task.name}`}
                  >
                    {STATUS_OPTIONS.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
                  </select>
                </div>

                {task.allow_files && (
                  <div className="vt-files">
                    {task.task_files.map((f) => (
                      <span key={f.id} className="vt-file-chip">
                        <span className="vt-file-ico" aria-hidden>▤</span>
                        <button className="vt-file-link" onClick={() => onOpenFile(f.path)}>{f.name}</button>
                        <button className="vt-file-x" onClick={() => onRemoveFile(vendor.id, task.id, f.id, f.path)} aria-label={`Remove ${f.name}`}>×</button>
                      </span>
                    ))}
                    <label className="vt-file-add">
                      + Add file
                      {/* Setting sheet also accepts Excel; other document tasks stay PDF/Word */}
                      <input type="file" accept={acceptFor(task)} multiple
                        onChange={(e) => { if (e.target.files.length) onAddFiles(vendor.id, task.id, e.target.files); e.target.value = ""; }} />
                    </label>
                  </div>
                )}
              </li>
            ))}
          </ol>
        </section>

        <section className="vt-panel">
          <h2 className="vt-h2">Comments</h2>
          <div className="vt-comments">
            {vendor.comments.length === 0 && <p className="vt-empty">No comments yet. Add the first note below.</p>}
            {vendor.comments.map((c) => (
              <div key={c.id} className="vt-comment">
                <div className="vt-comment-top">
                  <span className="vt-comment-author">{c.author}</span>
                  <span className="vt-comment-time">{fmtDate(c.created_at)}</span>
                </div>
                <p className="vt-comment-text">{c.body}</p>
              </div>
            ))}
          </div>
          <div className="vt-comment-box">
            <textarea placeholder="Add a comment…" rows={2} value={commentDraft}
              onChange={(e) => setCommentDraft(e.target.value)} />
            <button className="vt-btn vt-btn-primary" onClick={() => onAddComment(vendor.id, commentDraft)}>Post</button>
          </div>
        </section>
      </div>
    </>
  );
}

/* ================================================================== */
/*  STYLES                                                             */
/* ================================================================== */
const css = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Space+Grotesk:wght@500;600;700&display=swap');

.vt-root{
  --bg:#FFFFFF; --surface:#FFFFFF; --ink:#141C29; --muted:#647089;
  --line:#E1E6EF; --accent:#000080; --accent-soft:#E6E6F2;
  --todo:#98A2B6; --active:#E39A26; --done:#2E9E6B;
  --active-soft:#FBF1DE; --done-soft:#E4F4EC; --todo-soft:#EEF1F6;
  font-family:'Inter',system-ui,sans-serif; color:var(--ink);
  background:var(--bg); min-height:100vh; -webkit-font-smoothing:antialiased;
}
.vt-root *{box-sizing:border-box;}

.vt-topbar{display:flex; align-items:center; justify-content:space-between; padding:16px 28px; background:var(--surface); border-bottom:1px solid var(--line);}
.vt-brand{display:flex; align-items:baseline; gap:10px;}
.vt-brand-center{justify-content:center; margin-bottom:18px;}
.vt-wordmark{font-family:'Space Grotesk',sans-serif; font-weight:700; font-size:19px; letter-spacing:-.02em;}
.vt-me{display:flex; align-items:center; gap:12px; font-size:13px; color:var(--muted);}
.vt-me-email{font-weight:600; color:var(--ink);}
.vt-signout{font:inherit; font-size:13px; font-weight:600; color:var(--muted); background:none; border:1px solid var(--line); border-radius:7px; padding:6px 12px; cursor:pointer;}
.vt-signout:hover{color:var(--accent); border-color:var(--accent);}

.vt-main{max-width:960px; margin:0 auto; padding:32px 28px 64px;}
.vt-loading{color:var(--muted); font-size:15px; padding:40px 0; text-align:center;}

.vt-tabs{display:inline-flex; gap:4px; background:var(--surface); border:1px solid var(--line); border-radius:10px; padding:4px; margin-bottom:22px;}
.vt-tab{font:inherit; font-size:14px; font-weight:600; color:var(--muted); background:none; border:none; border-radius:7px; padding:8px 16px; cursor:pointer; transition:background .15s, color .15s;}
.vt-tab:hover{color:var(--ink);}
.vt-tab-on, .vt-tab-on:hover{background:var(--accent); color:#fff;}
.vt-tab:focus-visible{outline:2px solid var(--accent); outline-offset:2px;}

.vt-h1{font-family:'Space Grotesk',sans-serif; font-size:26px; font-weight:700; letter-spacing:-.02em; margin:0;}
.vt-sub{color:var(--muted); font-size:14px; margin:6px 0 0;}
.vt-h2{font-family:'Space Grotesk',sans-serif; font-size:15px; font-weight:600; margin:0;}

.vt-head-row{display:flex; align-items:flex-start; justify-content:space-between; gap:16px; margin-bottom:22px;}

.vt-btn{font:inherit; font-weight:600; font-size:14px; border-radius:9px; padding:10px 16px; cursor:pointer; border:1px solid transparent; transition:transform .06s, background .15s;}
.vt-btn:active{transform:translateY(1px);}
.vt-btn:disabled{opacity:.6; cursor:default;}
.vt-btn-primary{background:var(--accent); color:#fff;}
.vt-btn-primary:hover{background:#0000A6;}
.vt-btn-block{width:100%; margin-top:16px;}
.vt-btn-danger{background:var(--surface); color:#c0392b; border:1px solid #e6c3bf;}
.vt-btn-danger:hover{background:#fbeceb; border-color:#c0392b;}
.vt-btn:focus-visible{outline:2px solid var(--accent); outline-offset:2px;}

.vt-stats{display:grid; grid-template-columns:repeat(3,1fr); gap:14px; margin-bottom:24px;}
.vt-stat{background:var(--surface); border:1px solid var(--line); border-radius:12px; padding:18px 20px; display:flex; flex-direction:column; gap:4px;}
.vt-stat-n{font-family:'Space Grotesk',sans-serif; font-size:30px; font-weight:700; line-height:1;}
.vt-stat-label{font-size:13px; color:var(--muted);}
.vt-tone-text-ink{color:var(--ink);}
.vt-tone-text-active{color:var(--active);}
.vt-tone-text-done{color:var(--done);}

.vt-form-card{background:var(--surface); border:1px solid var(--line); border-radius:12px; padding:20px; margin-bottom:24px;}
.vt-form-fields{display:flex; gap:16px; flex-wrap:wrap;}
.vt-field{display:flex; flex-direction:column; gap:6px; font-size:13px; color:var(--muted); flex:1; min-width:180px;}
.vt-field-gap{margin-top:12px;}
.vt-field input{font:inherit; color:var(--ink); font-weight:500; border:1px solid var(--line); border-radius:8px; padding:10px 12px; background:var(--surface);}
.vt-field input:focus{outline:2px solid var(--accent-soft); border-color:var(--accent);}
.vt-field-owner{flex:0 0 auto;}
.vt-owner-chip{background:var(--accent-soft); color:var(--accent); font-weight:600; border-radius:8px; padding:10px 14px; font-size:14px; align-self:flex-start;}
.vt-form-note{font-size:13px; color:var(--muted); margin:14px 0 16px;}

.vt-list{background:var(--surface); border:1px solid var(--line); border-radius:12px; overflow:hidden;}
.vt-list-head{display:grid; grid-template-columns:1.4fr 1fr 1.1fr .8fr; gap:12px; padding:12px 20px 12px 24px; font-size:12px; text-transform:uppercase; letter-spacing:.05em; color:var(--muted); border-bottom:1px solid var(--line); background:#F7F9FC;}
.vt-list-empty{padding:28px 24px;}
.vt-row{position:relative; display:grid; grid-template-columns:1.4fr 1fr 1.1fr .8fr; gap:12px; align-items:center; width:100%; text-align:left; background:none; border:none; border-bottom:1px solid var(--line); padding:16px 20px 16px 24px; cursor:pointer; font:inherit; transition:background .12s;}
.vt-row:last-child{border-bottom:none;}
.vt-row:hover{background:#F7F9FC;}
.vt-row:focus-visible{outline:2px solid var(--accent); outline-offset:-2px;}
.vt-spine{position:absolute; left:0; top:0; bottom:0; width:4px;}
.vt-tone-todo{background:var(--todo);} .vt-tone-active{background:var(--active);} .vt-tone-done{background:var(--done);}
.vt-cell-vendor{display:flex; flex-direction:column; gap:2px;}
.vt-vendor-name{font-family:'Space Grotesk',sans-serif; font-weight:600; font-size:15.5px;}
.vt-cell-owner{font-size:13.5px; color:var(--ink);}
.vt-cell-progress{display:flex; align-items:center; gap:10px;}
.vt-bar{flex:1; height:6px; background:var(--line); border-radius:99px; overflow:hidden; max-width:120px;}
.vt-bar-fill{display:block; height:100%; border-radius:99px;}
.vt-bar-num{font-family:'Space Grotesk',sans-serif; font-size:12.5px; color:var(--muted); font-weight:600;}
.vt-cell-date{font-size:13px; color:var(--muted);}
.vt-chev{position:absolute; right:16px; color:var(--muted); font-size:22px; line-height:1;}

.vt-back{background:none; border:none; color:var(--muted); font:inherit; font-size:14px; cursor:pointer; padding:0; margin-bottom:18px;}
.vt-back:hover{color:var(--accent);}
.vt-detail-topbar{display:flex; align-items:center; justify-content:space-between; margin-bottom:18px;}
.vt-detail-topbar .vt-back{margin-bottom:0;}
.vt-detail-head{display:flex; align-items:flex-start; justify-content:space-between; gap:16px; margin-bottom:24px;}
.vt-detail-progress{text-align:right; flex:0 0 auto;}
.vt-detail-num{font-family:'Space Grotesk',sans-serif; font-size:30px; font-weight:700; line-height:1; display:block;}
.vt-detail-num-label{font-size:12px; color:var(--muted);}

.vt-info{display:grid; grid-template-columns:repeat(4,1fr); gap:12px; background:var(--surface); border:1px solid var(--line); border-radius:12px; padding:16px 18px; margin-bottom:18px;}
.vt-info-field{display:flex; flex-direction:column; gap:5px;}
.vt-info-label{font-size:11px; text-transform:uppercase; letter-spacing:.05em; color:var(--muted); font-weight:600;}
.vt-info-field input{font:inherit; font-size:14px; color:var(--ink); border:1px solid var(--line); border-radius:8px; padding:8px 10px; background:#FAFBFD;}
.vt-info-field input:focus{outline:2px solid var(--accent-soft); border-color:var(--accent); background:var(--surface);}
.vt-info-field input::placeholder{color:#AEB6C4;}

.vt-columns{display:grid; grid-template-columns:1.4fr 1fr; gap:18px; align-items:start;}
.vt-panel{background:var(--surface); border:1px solid var(--line); border-radius:12px; padding:20px;}
.vt-panel-hint{font-size:12.5px; color:var(--muted); margin:4px 0 14px;}

.vt-tasks{list-style:none; margin:0; padding:0;}
.vt-task{padding:14px 0; border-bottom:1px solid var(--line);}
.vt-task:last-child{border-bottom:none;}
.vt-task-main{display:grid; grid-template-columns:auto 1fr auto auto; gap:12px; align-items:center;}
.vt-task-idx{font-family:'Space Grotesk',sans-serif; font-size:12px; color:var(--muted); font-weight:600;}
.vt-task-name{font-size:14px; line-height:1.35;}
.vt-task-date{font-size:12px; color:var(--muted); white-space:nowrap;}

.vt-select{font:inherit; font-size:12.5px; font-weight:600; border-radius:8px; padding:6px 10px; cursor:pointer; border:1px solid var(--line); background:var(--surface);}
.vt-select:focus-visible{outline:2px solid var(--accent); outline-offset:2px;}
.vt-select-todo{background:var(--todo-soft); color:var(--muted);}
.vt-select-active{background:var(--active-soft); color:#a9751a; border-color:#eeddba;}
.vt-select-done{background:var(--done-soft); color:var(--done); border-color:#c4e6d5;}

.vt-files{display:flex; flex-wrap:wrap; gap:8px; margin:10px 0 0 30px;}
.vt-file-chip{display:inline-flex; align-items:center; gap:6px; background:#F2F5FA; border:1px solid var(--line); border-radius:8px; padding:5px 8px 5px 10px; font-size:12.5px;}
.vt-file-ico{color:var(--accent); font-size:12px;}
.vt-file-link{border:none; background:none; color:var(--accent); cursor:pointer; font:inherit; font-size:12.5px; padding:0;}
.vt-file-link:hover{text-decoration:underline;}
.vt-file-x{border:none; background:none; color:var(--muted); cursor:pointer; font-size:15px; line-height:1; padding:0 2px;}
.vt-file-x:hover{color:#c0392b;}
.vt-file-add{display:inline-flex; align-items:center; font-size:12.5px; font-weight:600; color:var(--accent); border:1px dashed #c3c3e0; border-radius:8px; padding:5px 10px; cursor:pointer;}
.vt-file-add:hover{background:var(--accent-soft);}
.vt-file-add input{display:none;}

.vt-comments{display:flex; flex-direction:column; gap:12px; margin:14px 0 16px;}
.vt-empty{font-size:13px; color:var(--muted); font-style:italic; margin:8px 0;}
.vt-comment{background:#F7F9FC; border:1px solid var(--line); border-radius:10px; padding:12px 14px;}
.vt-comment-top{display:flex; justify-content:space-between; align-items:baseline; margin-bottom:4px;}
.vt-comment-author{font-weight:600; font-size:13px;}
.vt-comment-time{font-size:11.5px; color:var(--muted);}
.vt-comment-text{font-size:13.5px; line-height:1.45; margin:0; color:#333c4d;}
.vt-comment-box{display:flex; flex-direction:column; gap:10px;}
.vt-comment-box textarea{font:inherit; font-size:14px; border:1px solid var(--line); border-radius:10px; padding:10px 12px; resize:vertical; background:var(--surface);}
.vt-comment-box textarea:focus{outline:2px solid var(--accent-soft); border-color:var(--accent);}
.vt-comment-box .vt-btn{align-self:flex-end;}

/* auth / config screens */
.vt-auth{display:flex; align-items:center; justify-content:center; min-height:100vh; padding:24px;}
.vt-auth-card{background:var(--surface); border:1px solid var(--line); border-radius:16px; padding:32px; width:100%; max-width:380px;}
.vt-auth-title{font-family:'Space Grotesk',sans-serif; font-size:20px; font-weight:700; margin:0 0 20px; text-align:center;}
.vt-auth-err{color:#c0392b; font-size:13px; margin:12px 0 0;}
.vt-auth-info{color:var(--done); font-size:13px; margin:12px 0 0;}
.vt-auth-switch{font-size:13px; color:var(--muted); text-align:center; margin:16px 0 0;}
.vt-auth-switch button{background:none; border:none; color:var(--accent); font:inherit; font-weight:600; cursor:pointer; padding:0;}
.vt-config-text{font-size:14px; line-height:1.5; color:var(--muted);}
.vt-config-text code{background:#F2F5FA; border-radius:5px; padding:1px 5px; font-size:12.5px; color:var(--ink);}

@media (max-width:720px){
  .vt-columns{grid-template-columns:1fr;}
  .vt-info{grid-template-columns:1fr 1fr;}
  .vt-stats{grid-template-columns:1fr;}
  .vt-list-head{display:none;}
  .vt-row{grid-template-columns:1fr auto; gap:8px 12px; padding-right:34px;}
  .vt-cell-owner{grid-column:1 / -1; font-size:12.5px; color:var(--muted);}
  .vt-cell-progress{grid-column:1;}
  .vt-cell-date{grid-column:2; text-align:right;}
  .vt-task-main{grid-template-columns:auto 1fr; gap:8px;}
  .vt-task-date{grid-column:2; grid-row:2;}
  .vt-select{grid-column:1 / -1; width:100%;}
  .vt-files{margin-left:0;}
}
`;
