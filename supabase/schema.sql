-- Közös naptár – futtasd le a Supabase SQL Editorban.
create extension if not exists pgcrypto;

create table if not exists public.calendars (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Közös naptár',
  invite_code text not null unique,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text,
  calendar_id uuid references public.calendars(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  calendar_id uuid not null references public.calendars(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  title text not null,
  description text not null default '',
  location text not null default '',
  start_at timestamptz not null,
  end_at timestamptz not null,
  all_day boolean not null default false,
  color text not null default '#3b82f6',
  recurrence text not null default 'none' check (recurrence in ('none','daily','weekly','monthly')),
  reminder_minutes integer not null default 15,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint event_end_after_start check (end_at >= start_at)
);

create index if not exists events_calendar_start_idx on public.events(calendar_id, start_at);
create index if not exists profiles_calendar_idx on public.profiles(calendar_id);

alter table public.calendars enable row level security;
alter table public.profiles enable row level security;
alter table public.events enable row level security;

-- Security-definer helper avoids recursive RLS when a profile policy checks
-- the current user's calendar membership.
create or replace function public.current_user_calendar_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select calendar_id from public.profiles where id = auth.uid()
$$;
revoke all on function public.current_user_calendar_id() from public;
grant execute on function public.current_user_calendar_id() to authenticated;

-- User profile: read members of the same calendar; update only own profile.
create policy "profiles_read_self_or_calendar" on public.profiles
for select to authenticated using (
  id = auth.uid() or (
    calendar_id is not null and calendar_id = public.current_user_calendar_id()
  )
);
create policy "profiles_insert_self" on public.profiles
for insert to authenticated with check (id = auth.uid());
create policy "profiles_update_self" on public.profiles
for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy "calendar_read_member" on public.calendars
for select to authenticated using (
  created_by = auth.uid() or id = public.current_user_calendar_id()
);
create policy "calendar_create_self" on public.calendars
for insert to authenticated with check (created_by = auth.uid());
create policy "calendar_update_creator" on public.calendars
for update to authenticated using (created_by = auth.uid()) with check (created_by = auth.uid());

create policy "events_read_calendar_member" on public.events
for select to authenticated using (
  calendar_id = public.current_user_calendar_id()
);
create policy "events_insert_calendar_member" on public.events
for insert to authenticated with check (
  created_by = auth.uid() and calendar_id = public.current_user_calendar_id()
);
create policy "events_update_calendar_member" on public.events
for update to authenticated using (
  calendar_id = public.current_user_calendar_id()
) with check (
  calendar_id = public.current_user_calendar_id()
);
create policy "events_delete_calendar_member" on public.events
for delete to authenticated using (
  calendar_id = public.current_user_calendar_id()
);

-- Create a profile automatically after sign-up.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, display_name)
  values (new.id, new.email, split_part(new.email, '@', 1))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

-- Join a calendar by invite code. A user can belong to only one calendar in this starter.
create or replace function public.join_calendar_by_code(p_code text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_calendar_id uuid;
begin
  if auth.uid() is null then raise exception 'Bejelentkezés szükséges.'; end if;
  select id into v_calendar_id from public.calendars
  where upper(invite_code) = upper(trim(p_code)) limit 1;
  if v_calendar_id is null then return null; end if;
  update public.profiles set calendar_id = v_calendar_id where id = auth.uid();
  return v_calendar_id;
end;
$$;
revoke all on function public.join_calendar_by_code(text) from public;
grant execute on function public.join_calendar_by_code(text) to authenticated;

-- Realtime: optional, enables instant event updates in multiple browsers.
alter publication supabase_realtime add table public.events;
