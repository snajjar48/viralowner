-- ViralOwner accounts. Run once in Supabase → SQL Editor (safe to rerun).
--
-- Logins themselves live in Supabase Auth (auth.users). This table holds the
-- extra sign-up details. Card numbers never touch our servers or this table;
-- Stripe stores the card and we only keep the Stripe customer id.

create table if not exists public.profiles (
  id                 uuid primary key references auth.users (id) on delete cascade,
  first_name         text not null,
  last_name          text not null,
  email              text not null,
  phone              text not null,
  billing_address    jsonb not null,
  stripe_customer_id text unique,
  has_payment_method boolean not null default false,
  terms_accepted_at  timestamptz not null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Signed-in users can read their own profile. There are deliberately no
-- insert/update/delete policies: only the server (using the secret key)
-- writes profiles, so users can't change their Stripe id or payment status.
drop policy if exists "Users can read their own profile" on public.profiles;
create policy "Users can read their own profile"
  on public.profiles for select
  to authenticated
  using ((select auth.uid()) = id);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();

-- Subscriptions (added later; safe to rerun). Mirrors Stripe, written only by
-- the server from Stripe's own data.
alter table public.profiles
  add column if not exists plan                 text,
  add column if not exists subscription_id      text,
  add column if not exists subscription_status  text,
  add column if not exists current_period_end   timestamptz,
  add column if not exists cancel_at_period_end boolean not null default false;
