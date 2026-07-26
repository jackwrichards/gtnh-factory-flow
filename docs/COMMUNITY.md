# Community plan hub

The community hub lets players share factory plans, browse and preview what
others built, vote, and open any shared plan directly in the editor.

## Architecture

- **Frontend**: `/community` (browser) and the Share button in the editor.
- **API**: Next.js routes under `src/app/api/community/**`. All validation,
  stat derivation, vote deduplication, and rate limiting happen here.
- **Storage**: Supabase Postgres, accessed exclusively with the service-role
  key from the API routes. Row level security is enabled with no public
  policies, so the anon key (which we never ship) can read nothing.
- **Identity**: anonymous. Votes and rate limits key on
  `sha256(salt + client IP + device id)`; raw IPs are never stored.
- **Trust model**: the server re-validates every uploaded plan against
  `factoryProjectSchema` and recomputes all stat-card numbers (power, machine
  count, highest tier, needs/outputs) with the real solver — clients cannot
  fabricate stats.

## Setup

1. Create a project at [supabase.com](https://supabase.com) (free tier is fine).
2. In the SQL editor, run the contents of `supabase/schema.sql`.
3. In **Project Settings → API**, copy:
   - the project URL → `SUPABASE_URL`
   - the `service_role` secret → `SUPABASE_SERVICE_ROLE_KEY`
4. Pick any random string for `COMMUNITY_HASH_SALT`.
5. Add all three to `.env.local` (dev) and the production host's environment.

Without these variables the rest of the app works normally; the community
endpoints return 503 and the hub page shows an error banner.

## Behavior notes

- Uploads: max 3 MB JSON, name ≤ 80 chars, description ≤ 2000 chars,
  10 uploads per hour per actor. Empty plans are rejected.
- Votes: one per plan per actor; re-sending the same vote retracts it.
  Counters are recomputed from the votes table on every vote, so they
  self-heal under races.
- Views: counted when a plan's preview/detail is opened, not per list render.
- Downloads: counted via the download endpoint (JSON download and
  "Open in editor" both use it).
- Thumbnails: JPEG data URLs (≤ 400 KB) captured client-side from the canvas
  at share time and stored inline in the row; the capture shrinks itself until
  it fits. Cards without a photo fall back to the plan's top output sprite.
- Ownership without accounts: uploads return a secret manage token stored in
  the uploader's browser (`gtnh-factory-flow.community-posts.v1`), linked to
  the design tab it came from. That token authorizes updating the post
  (re-share offers "update vs post as new") and taking it down. Clearing
  browser storage orphans the posts — that is the accepted trade for no logins.
- Moderation: set `COMMUNITY_ADMIN_TOKEN` and send it as the `x-admin-token`
  header on `DELETE /api/community/plans/<id>` to take down any post, or
  delete rows directly in the Supabase dashboard.
