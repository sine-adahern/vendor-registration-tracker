-- =========================================================
-- Vendor Onboarding Tracker — Supabase schema
-- Run this ONCE in the Supabase SQL Editor (Dashboard → SQL Editor → New query).
-- It is safe to re-run; it will not duplicate anything.
-- =========================================================

-- ---------- Tables ----------
create table if not exists vendors (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  added_by       text,                       -- email of the user who registered the vendor
  requester      text default '',
  contact_person text default '',
  contact_email  text default '',
  phone          text default '',
  created_at     timestamptz not null default now()
);

create table if not exists tasks (
  id             uuid primary key default gen_random_uuid(),
  vendor_id      uuid not null references vendors(id) on delete cascade,
  task_index     int  not null,
  name           text not null,
  allow_files    boolean not null default false,
  status         text not null default 'todo',   -- 'todo' | 'active' | 'done'
  last_attempted timestamptz
);

create table if not exists comments (
  id         uuid primary key default gen_random_uuid(),
  vendor_id  uuid not null references vendors(id) on delete cascade,
  author     text,                    -- email of the commenter
  body       text not null,
  created_at timestamptz not null default now()
);

create table if not exists task_files (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null references tasks(id) on delete cascade,
  name       text not null,           -- original filename
  path       text not null,           -- object path inside the storage bucket
  created_at timestamptz not null default now()
);

-- ---------- Auto-create the 7 standard tasks when a vendor is registered ----------
create or replace function create_default_tasks()
returns trigger
language plpgsql
as $$
begin
  insert into tasks (vendor_id, task_index, name, allow_files) values
    (new.id, 0, 'Get setting sheet & bank information', true),
    (new.id, 1, 'Confirm bank info', true),
    (new.id, 2, 'Confirm payment terms', false),
    (new.id, 3, 'Get confirmation statement & financial accounts', true),
    (new.id, 4, 'Get quantity & item info from engineers', false),
    (new.id, 5, 'Fill out VMS', false),
    (new.id, 6, 'Check VMS', false);
  return new;
end;
$$;

drop trigger if exists trg_create_default_tasks on vendors;
create trigger trg_create_default_tasks
after insert on vendors
for each row execute function create_default_tasks();

-- ---------- Row Level Security ----------
-- Model: any signed-in user can read and write everything (shared team tool).
-- You control access by who is given a login account.
alter table vendors    enable row level security;
alter table tasks      enable row level security;
alter table comments   enable row level security;
alter table task_files enable row level security;

drop policy if exists "authenticated full access" on vendors;
drop policy if exists "authenticated full access" on tasks;
drop policy if exists "authenticated full access" on comments;
drop policy if exists "authenticated full access" on task_files;

create policy "authenticated full access" on vendors
  for all to authenticated using (true) with check (true);
create policy "authenticated full access" on tasks
  for all to authenticated using (true) with check (true);
create policy "authenticated full access" on comments
  for all to authenticated using (true) with check (true);
create policy "authenticated full access" on task_files
  for all to authenticated using (true) with check (true);

-- ---------- Private storage bucket for uploaded documents ----------
insert into storage.buckets (id, name, public)
values ('vendor-files', 'vendor-files', false)
on conflict (id) do nothing;

drop policy if exists "authenticated read files"   on storage.objects;
drop policy if exists "authenticated upload files" on storage.objects;
drop policy if exists "authenticated delete files" on storage.objects;

create policy "authenticated read files" on storage.objects
  for select to authenticated using (bucket_id = 'vendor-files');
create policy "authenticated upload files" on storage.objects
  for insert to authenticated with check (bucket_id = 'vendor-files');
create policy "authenticated delete files" on storage.objects
  for delete to authenticated using (bucket_id = 'vendor-files');

-- =========================================================
-- User administration (admin panel)
-- =========================================================
-- Account creation is done from the in-app Admin panel, which calls a
-- serverless function that uses the SERVICE-ROLE key. Admin status is stored
-- in each user's app_metadata (only the service role can write it, so users
-- cannot promote themselves).
--
-- There must be a FIRST admin, created outside the app. After a user has
-- signed in at least once (so the row exists), promote them by email:
--
--   update auth.users
--   set raw_app_meta_data =
--         coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"admin"}'::jsonb
--   where email = 'you@company.com';
--
-- That user must sign out and back in for the new token to carry the role.
-- From then on they can create everyone else from the Admin panel.
--
-- To revoke admin from someone:
--
--   update auth.users
--   set raw_app_meta_data = raw_app_meta_data || '{"role":"user"}'::jsonb
--   where email = 'someone@company.com';
