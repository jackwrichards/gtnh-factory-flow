-- A single revision guards topology and unique plan membership together.
create table if not exists library_networks (
  user_id uuid primary key references community_users(id) on delete cascade,
  revision bigint not null check (revision > 0),
  networks jsonb not null default '[]'::jsonb
);
alter table library_networks enable row level security;
