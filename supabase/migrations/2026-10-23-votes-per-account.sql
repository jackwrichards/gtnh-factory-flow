-- ONE VOTE PER ACCOUNT PER PLAN.
--
-- Votes need an account. user_id names it, and the unique index refuses a
-- second vote by the same account on the same plan whatever voter_key says.
-- Votes cast without an account before this rule keep a null user_id.
-- Purely additive: the server retries a vote without user_id while this is
-- not applied. Idempotent. Mirrored at the end of supabase/schema.sql.

alter table community_votes
  add column if not exists user_id uuid references community_users (id) on delete cascade;

create unique index if not exists community_votes_one_per_account
  on community_votes (plan_id, user_id) where user_id is not null;
