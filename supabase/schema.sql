-- Community plan sharing schema.
-- Run this in the Supabase SQL editor (or `supabase db push`) once per project.
--
-- Access model: row level security is enabled with NO public policies.
-- Only the Next.js API routes talk to these tables, using the service-role
-- key, so all validation/rate limiting happens server-side in the app.

create table if not exists community_users (
  id uuid primary key default gen_random_uuid(),
  username text not null unique check (char_length(username) between 3 and 24),
  password_hash text not null,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

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
  user_id uuid references community_users (id) on delete cascade,
  author_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists community_plans_user_idx on community_plans (user_id);

create index if not exists community_plans_created_at_idx on community_plans (created_at desc);
create index if not exists community_plans_score_idx on community_plans (score desc);
create index if not exists community_plans_downloads_idx on community_plans (downloads desc);
create index if not exists community_plans_views_idx on community_plans (views desc);
create index if not exists community_plans_machine_count_idx on community_plans (machine_count desc);
create index if not exists community_plans_node_count_idx on community_plans (node_count desc);
create index if not exists community_plans_tier_idx on community_plans (highest_tier_index);

-- Columns added after the community_plans table first shipped; same
-- convergence rule as the blueprint ALTERs at the bottom of this file.
-- Author-curated tags, normalized lowercase; tags_text is the space-joined
-- copy the app maintains so ilike search reaches into tags.
alter table community_plans add column if not exists tags jsonb not null default '[]'::jsonb;
alter table community_plans add column if not exists tags_text text not null default '';
-- Unpublish without deleting: private posts stay on the owner's Mine shelf,
-- keeping votes and downloads. Defaults true so existing posts stay visible.
alter table community_plans add column if not exists is_public boolean not null default true;
-- The item face the author picked for list rows: {kind, resourceId, icon refs}.
alter table community_plans add column if not exists icon jsonb;
-- The app release whose solver computed the stored stat card. The plan detail
-- read recomputes stats from the plan JSON when this trails the running
-- release, so old cards heal as the solver improves. Empty means unknown,
-- which counts as stale.
alter table community_plans add column if not exists stats_version text not null default '';

create index if not exists community_plans_public_idx
  on community_plans (is_public, created_at desc);

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

alter table community_users enable row level security;
alter table community_plans enable row level security;
alter table community_votes enable row level security;
alter table community_events enable row level security;

-- Blueprints: per-user saved sub-assemblies — a captured board selection
-- (cards, wires, pockets, recipes) that can be stamped back into any design.
-- The OWNER may edit in place (rename, overwrite the payload from a board
-- pocket): the row keeps its id, votes, downloads and publish state, so an
-- author can refresh a published build without losing its standing.
-- Publishing flips is_public and stamps author/description/published_at.
-- Votes and downloads mirror community_plans.
-- Same access model as everything above: RLS on, no policies, service-role only.
create table if not exists blueprints (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references community_users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  payload jsonb not null,
  node_count integer not null default 0,
  storage_count integer not null default 0,
  edge_count integer not null default 0,
  pocket_count integer not null default 0,
  machine_count integer not null default 0,
  is_public boolean not null default false,
  description text not null default '' check (char_length(description) <= 500),
  author_name text not null default '',
  published_at timestamptz,
  -- The stat card: external needs and unconsumed outputs, computed at save
  -- time from the payload's own sub-plan solve (icons included), so listings
  -- can show what a blueprint eats and makes without fetching payloads.
  needs jsonb not null default '[]'::jsonb,
  outputs jsonb not null default '[]'::jsonb,
  -- Author-curated tags, normalized lowercase. tags_text is the same list
  -- space-joined, maintained by the app, so ilike search reaches into tags
  -- without jsonb gymnastics.
  tags jsonb not null default '[]'::jsonb,
  tags_text text not null default '',
  upvotes integer not null default 0,
  downvotes integer not null default 0,
  score integer generated always as (upvotes - downvotes) stored,
  downloads integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists blueprints_user_created_idx on blueprints (user_id, created_at desc);
create index if not exists blueprints_public_new_idx on blueprints (is_public, published_at desc);
create index if not exists blueprints_public_top_idx on blueprints (is_public, score desc);
create index if not exists blueprints_public_downloads_idx on blueprints (is_public, downloads desc);

alter table blueprints enable row level security;

-- Columns added after the blueprints table first shipped. `create table if
-- not exists` never alters an existing table, so re-running this file must
-- converge through idempotent ALTERs — keep every later addition here.
alter table blueprints add column if not exists needs jsonb not null default '[]'::jsonb;
alter table blueprints add column if not exists outputs jsonb not null default '[]'::jsonb;
alter table blueprints add column if not exists tags jsonb not null default '[]'::jsonb;
alter table blueprints add column if not exists tags_text text not null default '';
-- The item face the author picked for list rows: {kind, resourceId, icon refs}.
alter table blueprints add column if not exists icon jsonb;
-- Top voltage tier inside, derived at save time alongside the stat card.
alter table blueprints add column if not exists highest_tier text;
alter table blueprints add column if not exists highest_tier_index integer not null default -1;

-- One vote per anonymous actor per blueprint, exactly like community_votes.
create table if not exists blueprint_votes (
  blueprint_id uuid not null references blueprints (id) on delete cascade,
  voter_key text not null,
  value smallint not null check (value in (-1, 1)),
  created_at timestamptz not null default now(),
  primary key (blueprint_id, voter_key)
);

alter table blueprint_votes enable row level security;
