-- Community plan sharing schema.
-- Run this in the Supabase SQL editor (or `supabase db push`) once per project.
--
-- Access model: row level security is enabled with NO public policies.
-- Only the Next.js API routes talk to these tables, using the service-role
-- key, so all validation/rate limiting happens server-side in the app.

create table if not exists community_plans (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  description text not null default '' check (char_length(description) <= 2000),
  game_version text not null default '',
  dataset_version text not null default '',
  plan jsonb not null,
  thumbnail_data_url text,
  needs jsonb not null default '[]'::jsonb,
  outputs jsonb not null default '[]'::jsonb,
  total_eu_t double precision not null default 0,
  machine_count integer not null default 0,
  node_count integer not null default 0,
  storage_count integer not null default 0,
  edge_count integer not null default 0,
  highest_tier text,
  highest_tier_index integer not null default -1,
  upvotes integer not null default 0,
  downvotes integer not null default 0,
  score integer generated always as (upvotes - downvotes) stored,
  downloads integer not null default 0,
  views integer not null default 0,
  uploader_key text not null,
  created_at timestamptz not null default now()
);

create index if not exists community_plans_created_at_idx on community_plans (created_at desc);
create index if not exists community_plans_score_idx on community_plans (score desc);
create index if not exists community_plans_downloads_idx on community_plans (downloads desc);
create index if not exists community_plans_views_idx on community_plans (views desc);
create index if not exists community_plans_machine_count_idx on community_plans (machine_count desc);
create index if not exists community_plans_node_count_idx on community_plans (node_count desc);
create index if not exists community_plans_tier_idx on community_plans (highest_tier_index);

create table if not exists community_votes (
  plan_id uuid not null references community_plans (id) on delete cascade,
  voter_key text not null,
  value smallint not null check (value in (-1, 1)),
  created_at timestamptz not null default now(),
  primary key (plan_id, voter_key)
);

-- Sliding-window rate limiting, one row per accepted action.
create table if not exists community_events (
  id bigint generated always as identity primary key,
  actor_key text not null,
  action text not null,
  created_at timestamptz not null default now()
);

create index if not exists community_events_window_idx
  on community_events (actor_key, action, created_at desc);

alter table community_plans enable row level security;
alter table community_votes enable row level security;
alter table community_events enable row level security;
