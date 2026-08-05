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

## Where things live

```
src/App.jsx           — the entire app (UI, state, styles)
src/supabaseClient.js — connects to Supabase using your env vars
src/main.jsx          — React entry point
src/index.css         — minimal page reset
index.html            — HTML shell
supabase-schema.sql   — run once in Supabase to create the database
.env.example          — template for your Supabase keys
netlify.toml          — Netlify build + SPA redirect config
```
