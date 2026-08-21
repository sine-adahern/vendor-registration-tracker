# Vendorline — vendor onboarding tracker

A lightweight dashboard for tracking vendors through onboarding: register a vendor,
work its onboarding checklist, attach received documents, capture contact details,
and leave comments.

Built with React + Vite. Deploys as a static site (Netlify-ready).

## Run it locally

You need [Node.js](https://nodejs.org) 18 or newer installed.

```bash
npm install      # install dependencies
npm run dev      # start the dev server (prints a localhost URL)
```

To preview a production build locally:

```bash
npm run build    # outputs to dist/
npm run preview
```

## Push to GitHub

From this folder:

```bash
git init
git add .
git commit -m "Initial commit: vendor onboarding tracker"
git branch -M main
git remote add origin https://github.com/<your-username>/<your-repo>.git
git push -u origin main
```

(`node_modules/` and `dist/` are git-ignored on purpose — they get rebuilt.)

## Deploy on Netlify

1. In Netlify: **Add new site → Import an existing project** and pick your GitHub repo.
2. Netlify reads `netlify.toml`, so the settings are already filled in:
   - Build command: `npm run build`
   - Publish directory: `dist`
3. Deploy. Every push to `main` will trigger a new deploy automatically.

## Connect the database (Supabase)

This app stores its data in [Supabase](https://supabase.com) — a database, file
storage, and login all in one. Data is shared across everyone who signs in.
Until you connect it, the app shows an "Almost there" screen.

### 1. Create a Supabase project
Sign up at supabase.com, create a new project, and wait for it to finish setting up.

### 2. Create the tables
In the Supabase dashboard go to **SQL Editor → New query**, paste in the contents
of `supabase-schema.sql` (included in this project), and click **Run**. This creates
the tables, the rule that auto-adds the 7 tasks to each new vendor, the security
rules, and the private file-storage bucket.

### 3. Get your keys
In the dashboard go to **Project Settings → API** and copy two values:
- the **Project URL**
- the **anon / public** API key

### 4. Add the keys locally
Copy `.env.example` to a new file called `.env` and paste your values in:

```
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-public-key
```

Then run `npm run dev` and you should get a sign-in screen. Create an account,
and you're in.

### 5. Add the same keys in Netlify
In your Netlify site: **Site configuration → Environment variables**, add
`VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` with the same values, then
trigger a redeploy. (Env vars are read at build time, so a redeploy is required
after adding them.)

### Managing who can log in
Every signed-in user can see and edit all vendors — that's the intended shared-team
behaviour. You control access by who has an account. For an internal tool, go to
**Authentication → Providers/Settings** in Supabase and turn **off** open sign-ups,
then invite your teammates from **Authentication → Users**. You may also want to
turn email confirmation on or off there depending on how quickly you want people in.

### A note on the free tier
The free plan is fine for a small internal tool, with two things to know: projects
**pause after 7 days of no activity** (you unpause with one click, or upgrade to
avoid it), and the free plan has **no automatic backups**. For real vendor records,
consider the paid plan or set up backups once you're relying on it.

## User administration (admin panel)

New login accounts are created inside the app by an **admin**, so whoever you
hand this to never has to touch Supabase. Here's how it's wired and how to set
it up.

### How it works (and why it's safe)

Creating an account is a privileged action. In Supabase that requires the
**service-role key**, which must never be exposed to the browser. So the admin
panel doesn't create users directly — it calls a serverless function
(`netlify/functions/admin-users.mjs`) that runs on the server, and that
function:

1. **Authenticates** the caller by validating their Supabase login token.
2. **Authorises** them — the user must have `role: "admin"` in their
   `app_metadata`. Only the service role can write `app_metadata`, so a normal
   user cannot promote themselves. (It is deliberately *not* `user_metadata`,
   which users *can* edit.)
3. Only then uses the service-role key to create/list/delete the account.

The browser only ever holds the caller's own login token. Even if someone edits
the front-end code, the server re-checks admin status on every request, so they
still can't create accounts.

### 1. Add the service-role key in Netlify

In Supabase: **Project Settings → API → service_role** key (the secret one).
In Netlify: **Site configuration → Environment variables**, add:

```
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

Then redeploy. **Never** put this key in `.env`, in the repo, or in any
`VITE_`-prefixed variable — those get bundled into the browser. (The scheduled
digest function already uses this same variable, so you may have it set.)

### 2. Make the first admin

There has to be one admin to start with, created outside the app:

1. Create/confirm your own account and sign in once (so the user row exists).
   You can do this from **Authentication → Users → Add user** in Supabase.
2. In **SQL Editor**, run (using your email):

   ```sql
   update auth.users
   set raw_app_meta_data =
         coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"admin"}'::jsonb
   where email = 'you@company.com';
   ```

3. Sign out and back in. You'll now see an **Admin** button in the top bar.
   From there you can create everyone else (and tick "Make this user an admin"
   to add more admins).

### 3. Turn off open sign-ups (important)

So the *only* way in is an admin-created account, disable self-service sign-up
in Supabase: **Authentication → Sign In / Providers → Email** and turn off
**Allow new users to sign up**. The login screen no longer offers sign-up, but
this setting is what actually enforces it at the server.

### A note on the committed `.env`

This repo currently has a `.env` file committed even though it's in
`.gitignore`. It only contains the **publishable/anon** key, which is designed
to be public (security rests on Row Level Security), so it isn't an emergency —
but it's worth untracking so a secret is never committed there by accident:

```
git rm --cached .env
git commit -m "Stop tracking .env"
```

If you're ever unsure whether a real secret was committed, rotate the affected
keys in Supabase. And keep the **service-role** key out of the repo entirely —
it belongs only in Netlify's environment variables.

## Where things live

```
src/App.jsx           — the entire app (UI, state, styles; incl. admin panel)
netlify/functions/admin-users.mjs        — admin-only create/list/delete accounts
netlify/functions/lib/admin-guard.mjs    — server-side auth + admin check
src/supabaseClient.js — connects to Supabase using your env vars
src/main.jsx          — React entry point
src/index.css         — minimal page reset
index.html            — HTML shell
supabase-schema.sql   — run once in Supabase to create the database
.env.example          — template for your Supabase keys
netlify.toml          — Netlify build + SPA redirect config
```
